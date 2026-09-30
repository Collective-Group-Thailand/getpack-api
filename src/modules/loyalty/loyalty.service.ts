import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type PointsEntry, type PointsEntryType, type Prisma } from '@generated/prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { SettingsService } from '@platform/settings/settings.service';

import { earnPoints, pointsAfterRefund, pointsForBaht, tierFor } from './points-math';

const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());
const DAY_MS = 86_400_000;
const OPEN_INSTALMENTS = ['pending', 'due', 'overdue', 'partially_paid'] as const;

export function addMonths(at: Date, months: number): Date {
  const d = new Date(at.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

interface Links {
  orderId?: bigint | null;
  orderGroupId?: bigint | null;
  reviewId?: bigint | null;
  referralAttributionId?: bigint | null;
  reversesEntryId?: bigint | null;
  reason?: string | null;
  createdById?: bigint | null;
}

/**
 * Loyalty points (D-130…D-133, P10–P12). Earnings are written **pending** when an order completes and
 * credited — as a lot that expires 12 months later — once its claim window has passed and the group is
 * paid; activity and referral rewards are credited at once. Refunds take back the refunded share,
 * redemptions consume lots FIFO by expiry under row locks and come back when the order is cancelled,
 * lots expire with a reminder 30 days before. Every movement is a ledger row, an activity and an event
 * (`points.issued`, `points.redeemed`, `points.expired` feed the ledger postings P10–P12 in B5).
 */
@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
    private readonly audit: AuditService,
  ) {}

  // --- reads --------------------------------------------------------------------------------------------

  /** Available points (unexpired lots), pending earnings and lots expiring within the reminder window. */
  async summary(userId: bigint, now = new Date()) {
    const [membership, lots, pending, value, expiry, tiers] = await Promise.all([
      this.prisma.loyaltyMembership.findUnique({ where: { userId } }),
      this.prisma.pointsLot.findMany({
        where: { userId, remaining: { gt: 0 }, expiresAt: { gt: now } },
        orderBy: { expiresAt: 'asc' },
      }),
      this.prisma.pointsEntry.aggregate({ where: { userId, status: 'pending' }, _sum: { points: true } }),
      this.settings.at('loyalty.point_value', { at: now }),
      this.settings.at('loyalty.points_expiry', { at: now }),
      this.settings.at('loyalty.tiers', { at: now }),
    ]);
    const available = lots.reduce((a, l) => a + l.remaining, 0);
    // Tier progress (D-134): the next tier above my 12-month spend, from the tier settings, never computed by the web.
    const spend = D(membership?.spend12m.toString() ?? '0');
    const next = [...tiers.value]
      .sort((a, b) => D(a.minSpend12m).cmp(D(b.minSpend12m)))
      .find((t) => D(t.minSpend12m).gt(spend));
    const progressPct = next
      ? MoneyDecimal.min(spend.div(next.minSpend12m).mul(100), D(100)).toDecimalPlaces(2, MoneyDecimal.ROUND_DOWN).toFixed(2)
      : '100.00';
    const soon = new Date(now.getTime() + expiry.value.reminderDaysBefore * DAY_MS);
    return {
      tier: membership?.tier ?? 'member',
      multiplier: membership?.multiplier.toString() ?? '1',
      spend12m: membership?.spend12m.toFixed(2) ?? '0.00',
      nextTier: next?.tier ?? null,
      nextTierMinSpend12m: next ? D(next.minSpend12m).toFixed(2) : null,
      nextTierProgressPct: progressPct,
      availablePoints: available,
      pendingPoints: pending._sum.points ?? 0,
      pointValue: D(value.value).toFixed(2),
      availableValue: formatMoney(D(available).mul(value.value)),
      expiringSoon: lots
        .filter((l) => l.expiresAt <= soon)
        .map((l) => ({ points: l.remaining, expiresAt: l.expiresAt })),
    };
  }

  ledger(userId: bigint, page: number, perPage: number) {
    const where = { userId };
    return Promise.all([
      this.prisma.pointsEntry.findMany({
        where,
        include: {
          order: { select: { publicId: true, orderCode: true } },
          orderGroup: { select: { publicId: true, groupCode: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.pointsEntry.count({ where }),
    ]);
  }

  async availableBalance(db: Tx, userId: bigint, now = new Date()): Promise<number> {
    const r = await db.pointsLot.aggregate({
      where: { userId, remaining: { gt: 0 }, expiresAt: { gt: now } },
      _sum: { remaining: true },
    });
    return r._sum.remaining ?? 0;
  }

  // --- earning on completion (D-130, D-132) -------------------------------------------------------------

  @OnDomainEvent('order.fact_recorded', { consumer: 'loyalty.earn' })
  async onFact(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const { orderId, fact } = event.payload as { orderId: string; fact: string };
    if (fact !== 'completed') return;
    const order = await tx.order.findUnique({ where: { publicId: orderId } });
    if (order) await this.earnForOrder(tx, order.id);
  }

  /** The order's net before VAT, excluding shipping and after discounts (D-130 "paid" basis). */
  async earnBase(db: Tx, orderId: bigint): Promise<MoneyValue> {
    const lines = await db.orderLine.findMany({ where: { orderId, lineType: { not: 'shipping' } } });
    return lines.reduce((a, l) => a.add(D(l.netAmount).sub(l.discountAmount.toString())), D(0));
  }

  async earnForOrder(tx: Tx, orderId: bigint, now = new Date()): Promise<PointsEntry | null> {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.status !== 'completed') return null;
    if (await tx.pointsEntry.findFirst({ where: { orderId, entryType: 'earn_order' } })) return null;
    const [rate, value, window, membership] = await Promise.all([
      this.settings.at('loyalty.earn_rate', { at: now, tx }),
      this.settings.at('loyalty.point_value', { at: now, tx }),
      this.settings.at('claims.window_days', { at: now, tx }),
      tx.loyaltyMembership.findUnique({ where: { userId: order.customerUserId } }),
    ]);
    const base = await this.earnBase(tx, orderId);
    const points = earnPoints(base, rate.value.bahtPerPoint, membership?.multiplier.toString() ?? '1');
    if (points <= 0) return null;
    const completedAt = order.completedAt ?? now;
    const availableAt =
      order.claimWindowEndsAt ?? new Date(completedAt.getTime() + Number(window.value) * DAY_MS);
    const entry = await tx.pointsEntry.create({
      data: {
        userId: order.customerUserId,
        entryType: 'earn_order',
        points,
        pointValue: D(value.value).toFixed(6),
        pointValueSettingVersionId: value.versionId,
        bahtValue: formatMoney(D(points).mul(value.value)),
        status: 'pending',
        availableAt,
        orderId,
        orderGroupId: order.orderGroupId,
      },
    });
    await this.record(
      tx,
      order.customerUserId,
      entry,
      'points.earned',
      {
        points,
        base: formatMoney(base),
        availableAt: availableAt.toISOString(),
      },
      systemActor('loyalty.earn'),
    );
    return entry;
  }

  /**
   * Scheduled: pending earnings past their claim window are credited (a lot expiring 12 months later) once
   * the group has nothing left to pay; refunds recorded meanwhile reduce what is credited.
   */
  async creditDue(now = new Date(), limit = 500): Promise<number> {
    const due = await this.prisma.pointsEntry.findMany({
      where: { status: 'pending', availableAt: { lte: now } },
      orderBy: { availableAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    let credited = 0;
    for (const { id } of due) {
      try {
        const done = await this.prisma.withTx((tx) => this.credit(tx, id, now));
        if (done) credited += 1;
      } catch (error) {
        this.logger.error(`points entry ${id} not credited: ${(error as Error).message}`);
      }
    }
    return credited;
  }

  private async credit(tx: Tx, entryId: bigint, now: Date): Promise<boolean> {
    const entry = await tx.pointsEntry.findUniqueOrThrow({ where: { id: entryId } });
    if (entry.status !== 'pending') return false;
    if (entry.orderGroupId !== null) {
      const unpaid = await tx.instalment.count({
        where: { schedule: { orderGroupId: entry.orderGroupId }, status: { in: [...OPEN_INSTALMENTS] } },
      });
      if (unpaid > 0) return false;
    }
    const reversed = await tx.pointsEntry.aggregate({
      where: { reversesEntryId: entry.id, entryType: 'reversal_claim_refund' },
      _sum: { points: true },
    });
    const creditable = entry.points + (reversed._sum.points ?? 0);
    const actor = systemActor('loyalty.credit');
    if (creditable <= 0) {
      await tx.pointsEntry.update({ where: { id: entry.id }, data: { status: 'reversed' } });
      await this.record(tx, entry.userId, entry, 'points.earning_cancelled', { points: entry.points }, actor);
      return true;
    }
    const expiry = await this.settings.at('loyalty.points_expiry', { at: now, tx });
    const expiresAt = addMonths(now, expiry.value.monthsPerEarning);
    await tx.pointsEntry.update({ where: { id: entry.id }, data: { status: 'available', expiresAt } });
    await tx.pointsLot.create({
      data: {
        earnEntryId: entry.id,
        userId: entry.userId,
        points: creditable,
        remaining: creditable,
        expiresAt,
      },
    });
    await this.issued(tx, entry, creditable, actor);
    return true;
  }

  // --- activity and referral rewards (D-135, D-136) ----------------------------------------------------

  /** A reward in baht credited at once at the point value in force (rounded down, D-131). */
  async reward(
    tx: Tx,
    userId: bigint,
    type: PointsEntryType,
    baht: string,
    links: Links,
    actor: Actor,
    now = new Date(),
  ) {
    const value = await this.settings.at('loyalty.point_value', { at: now, tx });
    const points = pointsForBaht(baht, String(value.value));
    if (points <= 0) return null;
    const expiry = await this.settings.at('loyalty.points_expiry', { at: now, tx });
    const expiresAt = addMonths(now, expiry.value.monthsPerEarning);
    const entry = await tx.pointsEntry.create({
      data: {
        userId,
        entryType: type,
        points,
        pointValue: D(value.value).toFixed(6),
        pointValueSettingVersionId: value.versionId,
        bahtValue: formatMoney(D(points).mul(value.value)),
        status: 'available',
        expiresAt,
        orderId: links.orderId ?? null,
        reviewId: links.reviewId ?? null,
        referralAttributionId: links.referralAttributionId ?? null,
        reason: links.reason ?? null,
        createdById: links.createdById ?? null,
      },
    });
    await tx.pointsLot.create({
      data: { earnEntryId: entry.id, userId, points, remaining: points, expiresAt },
    });
    await this.issued(tx, entry, points, actor);
    return entry;
  }

  /** Sign-up reward for customers who registered themselves (not accounts CS created). */
  @OnDomainEvent('customer.registered', { consumer: 'loyalty.signup' })
  async onRegistered(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['via'] === 'cs') return;
    const user = await tx.user.findUnique({ where: { publicId: event.aggregateId } });
    if (!user || user.kind !== 'customer') return;
    if (await tx.pointsEntry.findFirst({ where: { userId: user.id, entryType: 'earn_signup' } })) return;
    const rewards = await this.settings.at('loyalty.activity_rewards', { tx });
    await this.reward(
      tx,
      user.id,
      'earn_signup',
      rewards.value.signupBaht,
      {},
      systemActor('loyalty.signup'),
    );
  }

  /** LINE linking reward, once (D-135). */
  @OnDomainEvent('customer.identity_linked', { consumer: 'loyalty.line_link' })
  async onIdentityLinked(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['provider'] !== 'line') return;
    const user = await tx.user.findUnique({ where: { publicId: event.aggregateId } });
    if (!user || user.kind !== 'customer') return;
    if (await tx.pointsEntry.findFirst({ where: { userId: user.id, entryType: 'earn_line_link' } })) return;
    const rewards = await this.settings.at('loyalty.activity_rewards', { tx });
    await this.reward(
      tx,
      user.id,
      'earn_line_link',
      rewards.value.lineLinkingBaht,
      {},
      systemActor('loyalty.line_link'),
    );
  }

  /** The referrer's reward once a referral qualifies (D-136); the referral becomes `rewarded`. */
  @OnDomainEvent('referral.qualified', { consumer: 'loyalty.referral' })
  async onReferralQualified(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const referral = await tx.referralAttribution.findUnique({ where: { publicId: event.aggregateId } });
    if (!referral || referral.status !== 'qualified') return;
    const baht = String(event.payload['rewardBaht']);
    await this.reward(
      tx,
      referral.referrerUserId,
      'earn_referral',
      baht,
      { referralAttributionId: referral.id },
      systemActor('loyalty.referral'),
    );
    await tx.referralAttribution.update({
      where: { id: referral.id },
      data: { status: 'rewarded', rewardedAt: new Date() },
    });
  }

  // --- reversals for refunds and claims (D-132) ------------------------------------------------------

  @OnDomainEvent('refund.succeeded', { consumer: 'loyalty.refund' })
  async onRefund(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const refund = await tx.refund.findUnique({
      where: { publicId: event.aggregateId },
      include: { payment: true },
    });
    if (!refund) return;
    const orderIds = refund.orderId
      ? [refund.orderId]
      : refund.payment.orderGroupId
        ? (
            await tx.order.findMany({
              where: { orderGroupId: refund.payment.orderGroupId },
              select: { id: true },
            })
          ).map((o) => o.id)
        : [];
    for (const orderId of orderIds) await this.reverseForOrder(tx, orderId, systemActor('loyalty.refund'));
  }

  /**
   * Brings an order's earning down to what its refunded base still allows. Refunds tied to the order count
   * fully; group-level refunds count by the order's share of the group's gross. Claims (B4.5) call this too.
   */
  async reverseForOrder(
    tx: Tx,
    orderId: bigint,
    actor: Actor,
    extraRefundedBase: MoneyValue = D(0),
  ): Promise<number> {
    const earn = await tx.pointsEntry.findFirst({
      where: { orderId, entryType: 'earn_order', status: { in: ['pending', 'available'] } },
    });
    if (!earn) return 0;
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const siblings = await tx.order.findMany({
      where: { orderGroupId: order.orderGroupId, status: { not: 'cancelled' } },
    });
    const groupGross = siblings.reduce((a, o) => a.add(o.grossAmount.toString()), D(0));
    const refunds = await tx.refund.findMany({
      where: {
        status: 'succeeded',
        OR: [{ orderId }, { orderId: null, payment: { orderGroupId: order.orderGroupId } }],
      },
    });
    const refundedGross = refunds.reduce(
      (a, r) =>
        a.add(
          r.orderId === orderId
            ? D(r.amount)
            : groupGross.gt(0)
              ? D(r.amount).mul(order.grossAmount.toString()).div(groupGross)
              : D(0),
        ),
      D(0),
    );
    const base = await this.earnBase(tx, orderId);
    const gross = D(order.grossAmount);
    const refundedBase = (gross.gt(0) ? refundedGross.mul(base).div(gross) : D(0)).add(extraRefundedBase);
    const target = pointsAfterRefund(earn.points, base, refundedBase);
    const already = await tx.pointsEntry.aggregate({
      where: { reversesEntryId: earn.id, entryType: 'reversal_claim_refund' },
      _sum: { points: true },
    });
    const toReverse = earn.points + (already._sum.points ?? 0) - target;
    if (toReverse <= 0) return 0;
    const entry = await tx.pointsEntry.create({
      data: {
        userId: earn.userId,
        entryType: 'reversal_claim_refund',
        points: -toReverse,
        pointValue: earn.pointValue,
        pointValueSettingVersionId: earn.pointValueSettingVersionId,
        bahtValue: formatMoney(D(toReverse).mul(earn.pointValue.toString())),
        status: 'available',
        orderId,
        orderGroupId: order.orderGroupId,
        reversesEntryId: earn.id,
      },
    });
    // A pending earning is simply credited smaller; a credited one gives the points back from its lots.
    const unrecovered =
      earn.status === 'available'
        ? toReverse - (await this.consume(tx, earn.userId, toReverse, entry.id, earn.id))
        : 0;
    await this.record(
      tx,
      earn.userId,
      entry,
      'points.reversed',
      {
        points: toReverse,
        orderId: order.publicId,
        earningStatus: earn.status,
        unrecoveredPoints: unrecovered,
      },
      actor,
    );
    return toReverse;
  }

  // --- redemption (D-133, P11) -------------------------------------------------------------------------

  /** Writes the group's redemption and takes the points from the lots (row-locked, FIFO by expiry). */
  async redeem(
    tx: Tx,
    userId: bigint,
    groupId: bigint,
    points: number,
    pointValue: string,
    versionId: bigint,
    actor: Actor,
  ) {
    const amount = formatMoney(D(points).mul(pointValue));
    const entry = await tx.pointsEntry.create({
      data: {
        userId,
        entryType: 'redeem',
        points: -points,
        pointValue: D(pointValue).toFixed(6),
        pointValueSettingVersionId: versionId,
        bahtValue: amount,
        status: 'available',
        orderGroupId: groupId,
      },
    });
    const taken = await this.consume(tx, userId, points, entry.id);
    if (taken < points)
      throw new DomainException('loyalty.insufficient_points', {
        params: { requested: points, available: taken },
      });
    await this.record(
      tx,
      userId,
      entry,
      'points.redeemed',
      {
        points,
        amount,
        groupId: (await tx.orderGroup.findUniqueOrThrow({ where: { id: groupId } })).publicId,
      },
      actor,
    );
    return entry;
  }

  /** A cancelled order gives back its share of the group's redeemed points (the last one gives the rest). */
  @OnDomainEvent('order.cancelled', { consumer: 'loyalty.redemption_return' })
  async onOrderCancelled(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const order = await tx.order.findUnique({ where: { publicId: event.aggregateId } });
    if (!order) return;
    const redeem = await tx.pointsEntry.findFirst({
      where: { orderGroupId: order.orderGroupId, entryType: 'redeem' },
    });
    if (!redeem) return;
    const discounts = await tx.orderDiscount.aggregate({
      where: { orderId: order.id, source: 'points_redemption' },
      _sum: { amount: true },
    });
    const amount = D(discounts._sum.amount ?? 0);
    if (amount.lte(0)) return;
    const returned = await tx.pointsEntry.aggregate({
      where: { reversesEntryId: redeem.id, entryType: 'redeem_reversal' },
      _sum: { points: true },
    });
    const outstanding = -redeem.points - (returned._sum.points ?? 0);
    const live = await tx.order.count({
      where: { orderGroupId: order.orderGroupId, status: { not: 'cancelled' } },
    });
    const points = Math.min(
      outstanding,
      live === 0 ? outstanding : amount.div(redeem.pointValue.toString()).floor().toNumber(),
    );
    if (points <= 0) return;
    const entry = await tx.pointsEntry.create({
      data: {
        userId: redeem.userId,
        entryType: 'redeem_reversal',
        points,
        pointValue: redeem.pointValue,
        pointValueSettingVersionId: redeem.pointValueSettingVersionId,
        bahtValue: formatMoney(D(points).mul(redeem.pointValue.toString())),
        status: 'available',
        orderId: order.id,
        orderGroupId: order.orderGroupId,
        reversesEntryId: redeem.id,
      },
    });
    await this.restore(tx, redeem.id, entry.id, points);
    await this.record(
      tx,
      redeem.userId,
      entry,
      'points.redemption_reversed',
      { points, orderId: order.publicId },
      systemActor('loyalty.redemption_return'),
    );
  }

  // --- expiry and reminders (D-132, P12) ------------------------------------------------------------

  /** Scheduled: lots past their expiry lose what is left (one `expire` entry per customer and run). */
  async expireDue(now = new Date()): Promise<number> {
    const users = await this.prisma.pointsLot.findMany({
      where: { remaining: { gt: 0 }, expiresAt: { lte: now } },
      distinct: ['userId'],
      select: { userId: true },
    });
    let expired = 0;
    for (const { userId } of users) {
      try {
        await this.prisma.withTx(async (tx) => {
          const lots = await tx.$queryRaw<{ id: bigint; remaining: number; earn_entry_id: bigint }[]>`
            SELECT id, remaining, earn_entry_id FROM points_lots
             WHERE user_id = ${userId} AND remaining > 0 AND expires_at <= ${now}
             ORDER BY expires_at, id FOR UPDATE`;
          if (lots.length === 0) return;
          const earns = await tx.pointsEntry.findMany({
            where: { id: { in: lots.map((l) => l.earn_entry_id) } },
          });
          const valueOf = new Map(earns.map((e) => [e.id, D(e.pointValue)]));
          const points = lots.reduce((a, l) => a + l.remaining, 0);
          const baht = lots.reduce((a, l) => a.add(valueOf.get(l.earn_entry_id)!.mul(l.remaining)), D(0));
          const version = earns[0]!.pointValueSettingVersionId;
          const entry = await tx.pointsEntry.create({
            data: {
              userId,
              entryType: 'expire',
              points: -points,
              pointValue: baht.div(points).toDecimalPlaces(6).toFixed(6),
              pointValueSettingVersionId: version,
              bahtValue: formatMoney(baht),
              status: 'available',
            },
          });
          for (const l of lots) {
            await tx.pointsLot.update({ where: { id: l.id }, data: { remaining: 0 } });
            await tx.pointsLotConsumption.create({
              data: { lotId: l.id, consumingEntryId: entry.id, points: l.remaining },
            });
          }
          await tx.pointsEntry.updateMany({
            where: { id: { in: earns.map((e) => e.id) }, status: 'available' },
            data: { status: 'expired' },
          });
          await this.record(
            tx,
            userId,
            entry,
            'points.expired',
            { points, bahtValue: formatMoney(baht) },
            systemActor('loyalty.expire'),
          );
          expired += 1;
        });
      } catch (error) {
        this.logger.error(`points expiry failed for user ${userId}: ${(error as Error).message}`);
      }
    }
    return expired;
  }

  /** Scheduled: one reminder per lot, 30 days (setting) before it expires. */
  async remindExpiring(now = new Date()): Promise<number> {
    const expiry = await this.settings.at('loyalty.points_expiry', { at: now });
    const until = new Date(now.getTime() + expiry.value.reminderDaysBefore * DAY_MS);
    const lots = await this.prisma.pointsLot.findMany({
      where: { remaining: { gt: 0 }, remindedAt: null, expiresAt: { gt: now, lte: until } },
      orderBy: { expiresAt: 'asc' },
    });
    const byUser = new Map<bigint, typeof lots>();
    for (const l of lots) byUser.set(l.userId, [...(byUser.get(l.userId) ?? []), l]);
    for (const [userId, own] of byUser) {
      await this.prisma.withTx(async (tx) => {
        const { count } = await tx.pointsLot.updateMany({
          where: { id: { in: own.map((l) => l.id) }, remindedAt: null },
          data: { remindedAt: now },
        });
        if (count === 0) return;
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { publicId: true } });
        const points = own.reduce((a, l) => a + l.remaining, 0);
        await this.events.record(
          tx,
          {
            type: 'points.expiring',
            aggregateType: 'user',
            aggregateId: user.publicId,
            payload: { userId: user.publicId, points, firstExpiresAt: own[0]!.expiresAt.toISOString() },
          },
          systemActor('loyalty.remind'),
        );
      });
    }
    return byUser.size;
  }

  // --- tiers (D-134) ------------------------------------------------------------------------------------

  /**
   * Nightly: every customer's tier from the spend of the last 12 months — completed orders, net before VAT,
   * excluding shipping, after discounts (the earning basis). Tier changes publish `loyalty.tier_changed`.
   */
  async recalculateTiers(now = new Date()): Promise<number> {
    const since = addMonths(now, -12);
    const tiers = await this.settings.at('loyalty.tiers', { at: now });
    const spends = await this.prisma.$queryRaw<{ user_id: bigint; spend: string }[]>`
      SELECT o.customer_user_id AS user_id, sum(l.net_amount - l.discount_amount)::text AS spend
        FROM orders o JOIN order_lines l ON l.order_id = o.id
       WHERE o.status = 'completed' AND o.completed_at > ${since} AND o.completed_at <= ${now}
         AND l.line_type <> 'shipping'
       GROUP BY o.customer_user_id`;
    const spendOf = new Map(spends.map((r) => [r.user_id, D(r.spend)]));
    const members = await this.prisma.loyaltyMembership.findMany({ select: { userId: true } });
    const users = new Set<bigint>([...spendOf.keys(), ...members.map((m) => m.userId)]);
    let changed = 0;
    for (const userId of users) {
      const spend = spendOf.get(userId) ?? D(0);
      const rule = tierFor(spend, tiers.value);
      await this.prisma.withTx(async (tx) => {
        const before = await tx.loyaltyMembership.findUnique({ where: { userId } });
        const data = {
          tier: rule.tier,
          spend12m: formatMoney(spend),
          multiplier: D(rule.multiplier).toFixed(2),
          tiersSettingVersionId: tiers.versionId,
          evaluatedAt: now,
        };
        await tx.loyaltyMembership.upsert({
          where: { userId },
          create: { userId, ...data },
          update: { ...data, rowVersion: { increment: 1 } },
        });
        if ((before?.tier ?? 'member') === rule.tier) return;
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { publicId: true } });
        const payload = {
          from: before?.tier ?? 'member',
          to: rule.tier,
          spend12m: formatMoney(spend),
          multiplier: data.multiplier,
        };
        const event = await this.events.record(
          tx,
          {
            type: 'loyalty.tier_changed',
            aggregateType: 'user',
            aggregateId: user.publicId,
            payload: { userId: user.publicId, ...payload },
          },
          systemActor('loyalty.tiers'),
        );
        await this.activity.record(tx, {
          aggregateType: 'user',
          aggregatePublicId: user.publicId,
          action: 'loyalty.tier_changed',
          messageKey: 'activity.loyalty.tier_changed',
          messageParams: payload,
          visibility: ['internal', 'customer'],
          domainEventId: event.id,
          actor: systemActor('loyalty.tiers'),
        });
        changed += 1;
      });
    }
    return changed;
  }

  // --- staff adjustments -------------------------------------------------------------------------------

  /**
   * Adds (a lot expiring 12 months later) or removes (FIFO from the lots) points with a reason; audited
   * as a finance action. Removing more than the balance is refused.
   */
  async adjust(
    actor: UserActor,
    userId: bigint,
    points: number,
    reason: string,
    now = new Date(),
  ): Promise<PointsEntry> {
    return this.prisma.withTx(async (tx) => {
      const value = await this.settings.at('loyalty.point_value', { at: now, tx });
      const expiry = await this.settings.at('loyalty.points_expiry', { at: now, tx });
      const positive = points > 0;
      const expiresAt = positive ? addMonths(now, expiry.value.monthsPerEarning) : null;
      const entry = await tx.pointsEntry.create({
        data: {
          userId,
          entryType: 'adjust',
          points,
          pointValue: D(value.value).toFixed(6),
          pointValueSettingVersionId: value.versionId,
          bahtValue: formatMoney(D(Math.abs(points)).mul(value.value)),
          status: 'available',
          expiresAt,
          reason,
          createdById: actor.userId,
        },
      });
      if (positive) {
        await tx.pointsLot.create({
          data: { earnEntryId: entry.id, userId, points, remaining: points, expiresAt: expiresAt! },
        });
      } else {
        const taken = await this.consume(tx, userId, -points, entry.id);
        if (taken < -points)
          throw new DomainException('loyalty.insufficient_points', {
            params: { requested: -points, available: taken },
          });
      }
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { publicId: true } });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'loyalty.points_adjusted',
        actor,
        resourceType: 'user',
        resourcePublicId: user.publicId,
        data: { points, reason, entryId: entry.publicId },
      });
      await this.record(tx, userId, entry, 'points.adjusted', { points, reason }, actor);
      return entry;
    });
  }

  // --- lots -------------------------------------------------------------------------------------------

  /** Takes up to `points` from unexpired lots (one lot first when given, then FIFO by expiry); returns what it took. */
  async consume(
    tx: Tx,
    userId: bigint,
    points: number,
    entryId: bigint,
    preferEarnEntryId?: bigint,
  ): Promise<number> {
    const lots = await tx.$queryRaw<{ id: bigint; remaining: number }[]>`
      SELECT id, remaining FROM points_lots
       WHERE user_id = ${userId} AND remaining > 0 AND expires_at > now()
       ORDER BY (earn_entry_id = ${preferEarnEntryId ?? -1n}) DESC, expires_at, id
       FOR UPDATE`;
    let left = points;
    for (const l of lots) {
      if (left <= 0) break;
      const take = Math.min(left, l.remaining);
      await tx.pointsLot.update({ where: { id: l.id }, data: { remaining: { decrement: take } } });
      await tx.pointsLotConsumption.create({
        data: { lotId: l.id, consumingEntryId: entryId, points: take },
      });
      left -= take;
    }
    return points - left;
  }

  /** Gives redeemed points back to the lots they came from, most recently consumed first. */
  private async restore(
    tx: Tx,
    redeemEntryId: bigint,
    reversalEntryId: bigint,
    points: number,
  ): Promise<void> {
    const taken = await tx.pointsLotConsumption.findMany({
      where: { consumingEntryId: redeemEntryId },
      orderBy: { id: 'desc' },
    });
    const reversals = await tx.pointsEntry.findMany({
      where: { reversesEntryId: redeemEntryId, entryType: 'redeem_reversal' },
      select: { id: true },
    });
    const given = await tx.pointsLotConsumption.groupBy({
      by: ['lotId'],
      where: { consumingEntryId: { in: reversals.map((r) => r.id) } },
      _sum: { points: true },
    });
    const back = new Map(given.map((g) => [g.lotId, -(g._sum.points ?? 0)]));
    let left = points;
    for (const c of taken) {
      if (left <= 0) break;
      const room = c.points - (back.get(c.lotId) ?? 0);
      if (room <= 0) continue;
      const put = Math.min(room, left);
      await tx.pointsLot.update({ where: { id: c.lotId }, data: { remaining: { increment: put } } });
      await tx.pointsLotConsumption.create({
        data: { lotId: c.lotId, consumingEntryId: reversalEntryId, points: -put },
      });
      back.set(c.lotId, (back.get(c.lotId) ?? 0) + put);
      left -= put;
    }
  }

  // --- helpers ------------------------------------------------------------------------------------------

  private async issued(tx: Tx, entry: PointsEntry, points: number, actor: Actor) {
    const rate = await this.settings.at('loyalty.expected_redemption_rate_pct', { tx });
    await this.record(
      tx,
      entry.userId,
      entry,
      'points.issued',
      {
        entryType: entry.entryType,
        points,
        pointValue: D(entry.pointValue).toFixed(2),
        bahtValue: formatMoney(D(points).mul(entry.pointValue.toString())),
        expectedRedemptionRatePct: String(rate.value),
        expiresAt: entry.expiresAt?.toISOString() ?? null,
      },
      actor,
    );
  }

  private async record(
    tx: Tx,
    userId: bigint,
    entry: PointsEntry,
    type: string,
    data: Record<string, unknown>,
    actor: Actor,
  ) {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { publicId: true } });
    const event = await this.events.record(
      tx,
      {
        type,
        aggregateType: 'user',
        aggregateId: user.publicId,
        // Amounts the ledger posts (P10–P12, ADR-0007): the entry's baht value and the liability rate.
        payload: {
          userId: user.publicId,
          entryId: entry.publicId,
          bahtValue: D(entry.bahtValue).abs().toFixed(2),
          signedBahtValue: (entry.points < 0
            ? D(entry.bahtValue).abs().neg()
            : D(entry.bahtValue).abs()
          ).toFixed(2),
          expectedRedemptionRatePct: String(
            (await this.settings.at('loyalty.expected_redemption_rate_pct', { tx })).value,
          ),
          ...data,
        },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'user',
      aggregatePublicId: user.publicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal', 'customer'],
      domainEventId: event.id,
      actor,
    });
  }
}

export type LedgerRow = Prisma.PointsEntryGetPayload<{
  include: {
    order: { select: { publicId: true; orderCode: true } };
    orderGroup: { select: { publicId: true; groupCode: true } };
  };
}>;
