import { type Actor, systemActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { type CheckoutDraft, type PlacedGroup } from '@modules/checkout/checkout.extensions';
import { Injectable, Logger } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

import { IdentityFingerprints } from './identity-fingerprints.service';

/** What the checkout extension decided for one promotion (kept in the draft state until placement). */
export interface AppliedPromotion {
  promotionId: bigint;
  promotionPublicId: string;
  couponCodeId: bigint | null;
  campaignId: bigint | null;
  usageLimitTotal: number | null;
  usageLimitPerCustomer: number | null;
  amount: string;
  cappedAmount: string;
  snapshot: Record<string, unknown>;
}

const D = (v: { toString(): string } | string) => new MoneyDecimal(v.toString());
const LIVE: Prisma.EnumRedemptionStatusFilter = { in: ['reserved', 'applied'] };

/**
 * Promotion usage (D-053, D-154): at placement a redemption is **reserved** under row-locked counters
 * (total, per customer incl. linked identities, per code) and the discount is spent from the campaign
 * and promotion budgets (alert at the snapshotted threshold, auto-stop when exhausted). It is **applied**
 * when the group is paid for production (or production starts) and **reversed** — usage and budget
 * given back — when its orders are cancelled or expire.
 */
@Injectable()
export class PromotionRedemptions {
  private readonly logger = new Logger(PromotionRedemptions.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityFingerprints,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
  ) {}

  // --- reserve (checkout transaction) -------------------------------------------------------------

  async reserve(tx: Tx, draft: CheckoutDraft, placed: PlacedGroup, applied: AppliedPromotion[]): Promise<void> {
    const customer = draft.customerUserId;
    const orderIds = placed.orders.map((o) => o.id);
    // A stable lock order keeps concurrent checkouts from deadlocking on counters.
    for (const a of [...applied].sort((x, y) => (x.promotionId < y.promotionId ? -1 : 1))) {
      await this.takeUsage(tx, a, customer);
      await this.spend(tx, a, draft.actor);
      const redemption = await tx.promotionRedemption.create({
        data: {
          promotionId: a.promotionId,
          couponCodeId: a.couponCodeId,
          campaignId: a.campaignId,
          orderGroupId: placed.groupId,
          customerUserId: customer,
          amount: a.amount,
          cappedAmount: a.cappedAmount,
          snapshot: a.snapshot as Prisma.InputJsonValue,
        },
      });
      await tx.orderDiscount.updateMany({
        where: { orderId: { in: orderIds }, promotionId: a.promotionId },
        data: { redemptionId: redemption.id },
      });
      await this.record(tx, placed.groupPublicId, 'promotion.reserved', {
        promotionId: a.promotionPublicId,
        redemptionId: redemption.publicId,
        amount: a.amount,
        cappedAmount: a.cappedAmount,
        code: (a.snapshot['code']) ?? null,
      }, draft.actor);
    }
  }

  private async takeUsage(tx: Tx, a: AppliedPromotion, customer: bigint): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO promotion_usage_counters (promotion_id, customer_key)
      VALUES (${a.promotionId}, 0), (${a.promotionId}, ${customer})
      ON CONFLICT (promotion_id, customer_key) DO NOTHING`;
    const total = await tx.$executeRaw`
      UPDATE promotion_usage_counters SET used_count = used_count + 1
       WHERE promotion_id = ${a.promotionId} AND customer_key = 0
         AND (${a.usageLimitTotal}::int IS NULL OR used_count < ${a.usageLimitTotal}::int)`;
    if (total !== 1) throw new DomainException('promotions.limit_reached');
    // Per person: this account's counter (row-locked) plus live redemptions of linked accounts.
    const related = await this.identity.relatedUserIds(tx, customer);
    const relatedUsed = related.length
      ? await tx.promotionRedemption.count({
          where: { promotionId: a.promotionId, customerUserId: { in: related }, status: LIVE },
        })
      : 0;
    const own = await tx.$executeRaw`
      UPDATE promotion_usage_counters SET used_count = used_count + 1
       WHERE promotion_id = ${a.promotionId} AND customer_key = ${customer}
         AND (${a.usageLimitPerCustomer}::int IS NULL OR used_count + ${relatedUsed}::int < ${a.usageLimitPerCustomer}::int)`;
    if (own !== 1) throw new DomainException('promotions.limit_reached');
    if (a.couponCodeId !== null) {
      const code = await tx.$executeRaw`
        UPDATE coupon_codes
           SET used_count = used_count + 1,
               status = CASE WHEN usage_limit IS NOT NULL AND used_count + 1 >= usage_limit
                             THEN 'used_up'::coupon_status ELSE status END
         WHERE id = ${a.couponCodeId} AND status = 'active'
           AND (usage_limit IS NULL OR used_count < usage_limit)`;
      if (code !== 1) throw new DomainException('promotions.limit_reached');
    }
  }

  /** Spends the discount from the promotion and campaign budgets; never beyond them (D-154). */
  private async spend(tx: Tx, a: AppliedPromotion, actor: Actor): Promise<void> {
    const promo = await tx.$executeRaw`
      UPDATE promotions SET spent_amount = spent_amount + ${a.amount}::numeric
       WHERE id = ${a.promotionId}
         AND (budget_amount IS NULL OR spent_amount + ${a.amount}::numeric <= budget_amount)`;
    if (promo !== 1) throw new DomainException('promotions.budget_exhausted');
    if (a.campaignId === null) return;
    const rows = await tx.$queryRaw<
      { public_id: string; spent_amount: string; budget_amount: string | null; alert_threshold_pct: string; alerted_at: Date | null }[]
    >`
      UPDATE campaigns SET spent_amount = spent_amount + ${a.amount}::numeric, updated_at = now()
       WHERE id = ${a.campaignId} AND status = 'active'
         AND (budget_amount IS NULL OR spent_amount + ${a.amount}::numeric <= budget_amount)
      RETURNING public_id, spent_amount::text, budget_amount::text, alert_threshold_pct::text, alerted_at`;
    const c = rows[0];
    if (!c) throw new DomainException('promotions.budget_exhausted');
    if (c.budget_amount === null) return;
    const budget = D(c.budget_amount);
    const spent = D(c.spent_amount);
    if (c.alerted_at === null && spent.gte(budget.mul(c.alert_threshold_pct).div(100))) {
      await tx.campaign.update({ where: { id: a.campaignId }, data: { alertedAt: new Date() } });
      await this.recordCampaign(tx, c.public_id, 'campaign.budget_alert', {
        spentAmount: formatMoney(spent),
        budgetAmount: formatMoney(budget),
        alertThresholdPct: c.alert_threshold_pct,
      }, actor);
    }
    if (spent.gte(budget)) {
      await tx.campaign.update({ where: { id: a.campaignId }, data: { status: 'exhausted', rowVersion: { increment: 1 } } });
      await this.recordCampaign(tx, c.public_id, 'campaign.exhausted', {
        spentAmount: formatMoney(spent),
        budgetAmount: formatMoney(budget),
      }, actor);
    }
  }

  // --- apply when paid ---------------------------------------------------------------------------------

  @OnDomainEvent('order.fact_recorded', { consumer: 'promotions.apply' })
  async onFact(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const { orderId, fact } = event.payload as { orderId: string; fact: string };
    if (fact !== 'paid_for_production' && fact !== 'production_started') return;
    const order = await tx.order.findUnique({ where: { publicId: orderId }, include: { orderGroup: true } });
    if (!order) return;
    const reserved = await tx.promotionRedemption.findMany({
      where: { orderGroupId: order.orderGroupId, status: 'reserved' },
      include: { promotion: true },
    });
    const actor = systemActor('promotions.apply');
    for (const r of reserved) {
      await tx.promotionRedemption.update({ where: { id: r.id }, data: { status: 'applied', appliedAt: new Date() } });
      await this.record(tx, order.orderGroup.publicId, 'promotion.redeemed', {
        promotionId: r.promotion.publicId,
        redemptionId: r.publicId,
        amount: r.amount.toFixed(2),
      }, actor);
    }
  }

  // --- reverse on cancellation -------------------------------------------------------------------------

  /** A cancelled order gives its discount back to the budgets; the last one reverses the redemption. */
  @OnDomainEvent('order.cancelled', { consumer: 'promotions.reverse' })
  async onCancelled(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const order = await tx.order.findUnique({ where: { publicId: event.aggregateId }, include: { orderGroup: true } });
    if (!order) return;
    const discounts = await tx.orderDiscount.findMany({ where: { orderId: order.id, redemptionId: { not: null } } });
    const byRedemption = new Map<bigint, MoneyValue>();
    for (const d of discounts) {
      byRedemption.set(d.redemptionId!, (byRedemption.get(d.redemptionId!) ?? D(0)).add(d.amount.toString()));
    }
    const actor = systemActor('promotions.reverse');
    for (const [redemptionId, released] of byRedemption) {
      const r = await tx.promotionRedemption.findUniqueOrThrow({ where: { id: redemptionId }, include: { promotion: true } });
      if (r.status === 'reversed') continue;
      const amount = formatMoney(released);
      await tx.$executeRaw`
        UPDATE promotions SET spent_amount = GREATEST(spent_amount - ${amount}::numeric, 0) WHERE id = ${r.promotionId}`;
      if (r.campaignId !== null)
        await tx.$executeRaw`
          UPDATE campaigns SET spent_amount = GREATEST(spent_amount - ${amount}::numeric, 0), updated_at = now()
           WHERE id = ${r.campaignId}`;
      const stillLive = await tx.orderDiscount.count({
        where: { redemptionId, order: { status: { not: 'cancelled' } } },
      });
      const left = MoneyDecimal.max(D(r.amount).sub(released), D(0));
      if (stillLive > 0) {
        await tx.promotionRedemption.update({ where: { id: r.id }, data: { amount: formatMoney(left) } });
        await this.record(tx, order.orderGroup.publicId, 'promotion.reduced', {
          promotionId: r.promotion.publicId,
          redemptionId: r.publicId,
          releasedAmount: amount,
        }, actor);
        continue;
      }
      await tx.promotionRedemption.update({
        where: { id: r.id },
        data: { amount: formatMoney(left), status: 'reversed', reversedAt: new Date() },
      });
      await tx.$executeRaw`
        UPDATE promotion_usage_counters SET used_count = GREATEST(used_count - 1, 0)
         WHERE promotion_id = ${r.promotionId} AND customer_key IN (0, ${r.customerUserId})`;
      if (r.couponCodeId !== null)
        await tx.$executeRaw`
          UPDATE coupon_codes
             SET used_count = GREATEST(used_count - 1, 0),
                 status = CASE WHEN status = 'used_up' THEN 'active'::coupon_status ELSE status END
           WHERE id = ${r.couponCodeId}`;
      await this.record(tx, order.orderGroup.publicId, 'promotion.reversed', {
        promotionId: r.promotion.publicId,
        redemptionId: r.publicId,
        releasedAmount: amount,
      }, actor);
    }
  }

  // --- payment method enforcement ---------------------------------------------------------------------

  /** Methods every live promotion of the group allows (empty = no restriction). */
  async requiredPaymentMethods(db: Tx, groupId: bigint): Promise<string[]> {
    const rows = await db.promotionRedemption.findMany({
      where: { orderGroupId: groupId, status: LIVE },
      select: { snapshot: true },
    });
    let allowed: string[] | null = null;
    for (const r of rows) {
      const methods = ((r.snapshot as { conditions?: { paymentMethods?: string[] } }).conditions?.paymentMethods) ?? null;
      if (!methods) continue;
      allowed = allowed === null ? methods : allowed.filter((m) => methods.includes(m));
    }
    return allowed ?? [];
  }

  // --- campaign and promotion windows -------------------------------------------------------------

  /** Scheduled campaigns start at `starts_at`; campaigns and promotions end at `ends_at`. */
  async refreshWindows(now = new Date()): Promise<number> {
    const actor = systemActor('promotions.refresh_windows');
    let changed = 0;
    const due = await this.prisma.campaign.findMany({
      where: {
        OR: [
          { status: 'scheduled', startsAt: { lte: now } },
          { status: { in: ['draft', 'scheduled', 'active', 'paused', 'exhausted'] }, endsAt: { lte: now } },
        ],
      },
    });
    for (const c of due) {
      const to = c.endsAt && c.endsAt <= now ? 'ended' : 'active';
      await this.prisma.withTx(async (tx) => {
        const n = await tx.campaign.updateMany({ where: { id: c.id, status: c.status }, data: { status: to, rowVersion: { increment: 1 } } });
        if (n.count === 1) await this.recordCampaign(tx, c.publicId, `campaign.${to}`, { from: c.status }, actor);
      });
      changed += 1;
    }
    const ended = await this.prisma.promotion.findMany({
      where: { status: { in: ['draft', 'active', 'paused'] }, endsAt: { lte: now } },
    });
    for (const p of ended) {
      await this.prisma.withTx(async (tx) => {
        const n = await tx.promotion.updateMany({ where: { id: p.id, status: p.status }, data: { status: 'ended', rowVersion: { increment: 1 } } });
        if (n.count !== 1) return;
        const event = await this.events.record(
          tx,
          { type: 'promotion.ended', aggregateType: 'promotion', aggregateId: p.publicId, payload: { promotionId: p.publicId, from: p.status } },
          actor,
        );
        await this.activity.record(tx, {
          aggregateType: 'promotion',
          aggregatePublicId: p.publicId,
          action: 'promotion.ended',
          messageKey: 'activity.promotion.ended',
          messageParams: { from: p.status },
          visibility: ['internal'],
          domainEventId: event.id,
          actor,
        });
      });
      changed += 1;
    }
    if (changed) this.logger.log(`promotion windows: ${changed} change(s)`);
    return changed;
  }

  // --- helpers ------------------------------------------------------------------------------------------

  private async record(tx: Tx, groupPublicId: string, type: string, data: Record<string, unknown>, actor: Actor) {
    const event = await this.events.record(
      tx,
      { type, aggregateType: 'order_group', aggregateId: groupPublicId, payload: { groupId: groupPublicId, ...data } },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'order_group',
      aggregatePublicId: groupPublicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal'],
      domainEventId: event.id,
      actor,
    });
  }

  private async recordCampaign(tx: Tx, campaignPublicId: string, type: string, data: Record<string, unknown>, actor: Actor) {
    const event = await this.events.record(
      tx,
      { type, aggregateType: 'campaign', aggregateId: campaignPublicId, payload: { campaignId: campaignPublicId, ...data } },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'campaign',
      aggregatePublicId: campaignPublicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal'],
      domainEventId: event.id,
      actor,
    });
  }
}
