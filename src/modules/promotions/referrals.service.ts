import { randomBytes } from 'node:crypto';

import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { startOfBangkokMonth } from '@common/time/bangkok';
import { AppConfig } from '@config/app-config';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma, type ReferralAttribution, type ReferralStatus } from '@generated/prisma/client';
import { CustomersService } from '@modules/customers/customers.service';
import { Injectable, Logger } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { ApprovalsService } from '@platform/approvals/approvals.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { SettingsService } from '@platform/settings/settings.service';

const POLICY = 'referral_review';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const REFERRAL_INCLUDE = {
  referrer: { select: { publicId: true, displayName: true } },
  referee: { select: { publicId: true, displayName: true } },
  firstOrderGroup: { select: { publicId: true, groupCode: true, status: true } },
  approvalRequest: { select: { publicId: true, status: true } },
} as const satisfies Prisma.ReferralAttributionInclude;
export type ReferralRow = Prisma.ReferralAttributionGetPayload<{ include: typeof REFERRAL_INCLUDE }>;

/**
 * The referral programme (D-136). A customer shares a code or link; a new customer claims it once,
 * before their first order, and gets the referee discount on that order (system promotion, checkout
 * extension). Once the referee's first order has passed the claim window the referral is checked:
 * a phone, address, card or device matching the referrer means no reward; referees linked to each
 * other or a referrer over the monthly cap go to Marketing (`referral_review`); otherwise it qualifies
 * and `referral.qualified` asks loyalty (B3.4) for the referrer's points.
 */
@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly settings: SettingsService,
    private readonly approvals: ApprovalsService,
    private readonly config: AppConfig,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
  ) {}

  // --- the referrer's code ------------------------------------------------------------------------

  /** The customer's referral code (created on first use), link and referral counts by status. */
  async mine(userId: bigint) {
    const code = await this.prisma.withTx(async (tx) => {
      const profile = await this.customers.ensureProfile(tx, userId);
      if (profile.referralCode) return profile.referralCode;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = [...randomBytes(8)].map((b) => ALPHABET[b % ALPHABET.length]).join('');
        if (await tx.customerProfile.findUnique({ where: { referralCode: candidate } })) continue;
        await tx.customerProfile.update({
          where: { userId },
          data: { referralCode: candidate, rowVersion: { increment: 1 } },
        });
        return candidate;
      }
      throw new Error('could not allocate a referral code');
    });
    const counts = await this.prisma.referralAttribution.groupBy({
      by: ['status'],
      where: { referrerUserId: userId },
      _count: { _all: true },
    });
    const web = this.config.get('STOREFRONT_BASE_URL') ?? 'https://www.packio.invalid';
    const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Partial<
      Record<ReferralStatus, number>
    >;
    return {
      code,
      link: `${web.replace(/\/$/, '')}/r/${code}`,
      referrals: {
        pending: byStatus.pending ?? 0,
        underReview: byStatus.under_review ?? 0,
        qualified: byStatus.qualified ?? 0,
        rewarded: byStatus.rewarded ?? 0,
        rejected: byStatus.rejected_fraud ?? 0,
      },
    };
  }

  // --- attribution ----------------------------------------------------------------------------------

  /** A new customer claims a referral code once, before their first order (D-136). */
  async attribute(actor: UserActor, rawCode: string): Promise<ReferralRow> {
    const code = rawCode.trim().toUpperCase();
    return this.prisma.withTx(async (tx) => {
      const referee = await this.customers.ensureProfile(tx, actor.userId);
      const referrer = /^[A-Z0-9]{6,12}$/.test(code)
        ? await tx.customerProfile.findUnique({ where: { referralCode: code } })
        : null;
      if (!referrer) throw new DomainException('referrals.code_invalid');
      if (referrer.userId === actor.userId) throw new DomainException('referrals.self_referral');
      if (await tx.referralAttribution.findUnique({ where: { refereeUserId: actor.userId } }))
        throw new DomainException('referrals.already_attributed');
      const placed = await tx.orderGroup.count({
        where: { customerUserId: actor.userId, status: { not: 'cancelled' } },
      });
      if (placed > 0) throw new DomainException('referrals.not_new_customer');
      const row = await tx.referralAttribution.create({
        data: { referrerUserId: referrer.userId, refereeUserId: actor.userId, referralCode: code },
      });
      await tx.customerProfile.update({
        where: { userId: referee.userId },
        data: { referredByUserId: referrer.userId, rowVersion: { increment: 1 } },
      });
      await this.record(tx, row, 'referral.attributed', { code }, actor);
      return this.get(row.publicId, tx);
    });
  }

  async get(publicId: string, db: Tx = this.prisma): Promise<ReferralRow> {
    const row = await db.referralAttribution.findUnique({ where: { publicId }, include: REFERRAL_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  list(where: Prisma.ReferralAttributionWhereInput, page: number, perPage: number) {
    return Promise.all([
      this.prisma.referralAttribution.findMany({
        where,
        include: REFERRAL_INCLUDE,
        orderBy: { attributedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.referralAttribution.count({ where }),
    ]);
  }

  // --- first order ------------------------------------------------------------------------------------

  /** Called at placement: the referee's first placed group is the one that must pass the claim window. */
  async markFirstOrder(tx: Tx, refereeUserId: bigint, groupId: bigint): Promise<void> {
    await tx.referralAttribution.updateMany({
      where: { refereeUserId, status: 'pending', firstOrderGroupId: null },
      data: { firstOrderGroupId: groupId },
    });
  }

  /** A cancelled or expired first order frees the referral for the referee's next order. */
  @OnDomainEvent(['order_group.cancelled', 'order_group.expired'], { consumer: 'referrals.first_order' })
  async onGroupCancelled(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const group = await tx.orderGroup.findUnique({ where: { publicId: event.aggregateId } });
    if (!group) return;
    await tx.referralAttribution.updateMany({
      where: { firstOrderGroupId: group.id, status: 'pending' },
      data: { firstOrderGroupId: null },
    });
  }

  // --- qualification ----------------------------------------------------------------------------------

  /**
   * Scheduled: referrals whose first order is complete and past its claim window are checked (D-136).
   * Returns how many were decided.
   */
  async qualifyDue(now = new Date(), limit = 200): Promise<number> {
    const due = await this.prisma.referralAttribution.findMany({
      where: {
        status: 'pending',
        firstOrderGroup: {
          status: 'completed',
          orders: {
            some: { status: 'completed' },
            every: { OR: [{ status: 'cancelled' }, { claimWindowEndsAt: { lte: now } }] },
          },
        },
      },
      take: limit,
      orderBy: { attributedAt: 'asc' },
    });
    let decided = 0;
    for (const a of due) {
      try {
        await this.prisma.withTx(async (tx) => {
          const current = await tx.referralAttribution.findUniqueOrThrow({ where: { id: a.id } });
          if (current.status !== 'pending') return;
          await this.decide(tx, current, now);
          decided += 1;
        });
      } catch (error) {
        this.logger.error(`referral ${a.publicId} not qualified: ${(error as Error).message}`);
      }
    }
    return decided;
  }

  private async decide(tx: Tx, a: ReferralAttribution, now: Date): Promise<void> {
    const actor = systemActor('referrals.qualify');
    const matches = await tx.$queryRaw<{ kind: string }[]>`
      SELECT DISTINCT r.kind::text AS kind
        FROM identity_fingerprints r
        JOIN identity_fingerprints e ON e.kind = r.kind AND e.value_hash = r.value_hash
       WHERE r.user_id = ${a.referrerUserId} AND e.user_id = ${a.refereeUserId}`;
    if (matches.length > 0) {
      // D-136: no reward when the referee shares a phone, address, card or device with the referrer.
      const flags = matches.map((m) => `${m.kind}_match`).sort();
      const row = await tx.referralAttribution.update({
        where: { id: a.id },
        data: { status: 'rejected_fraud', fraudFlags: flags, decidedAt: now },
      });
      await this.record(tx, row, 'referral.rejected', { flags }, actor);
      return;
    }

    const flags: string[] = [];
    const linked = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(DISTINCT other.referee_user_id) AS n
        FROM referral_attributions other
        JOIN identity_fingerprints theirs ON theirs.user_id = other.referee_user_id
        JOIN identity_fingerprints mine ON mine.kind = theirs.kind AND mine.value_hash = theirs.value_hash
       WHERE other.referrer_user_id = ${a.referrerUserId}
         AND other.referee_user_id <> ${a.refereeUserId}
         AND mine.user_id = ${a.refereeUserId}`;
    if ((linked[0]?.n ?? 0n) > 0n) flags.push('linked_referees');
    const rules = (await this.settings.at('referral.rules', { at: now })).value;
    const thisMonth = await tx.referralAttribution.count({
      where: {
        referrerUserId: a.referrerUserId,
        status: { in: ['qualified', 'rewarded'] },
        qualifiedAt: { gte: startOfBangkokMonth(now) },
      },
    });
    if (thisMonth >= rules.maxRewardedReferralsPerMonth) flags.push('monthly_cap');

    if (flags.length > 0) {
      const referrer = await tx.user.findUniqueOrThrow({
        where: { id: a.referrerUserId },
        select: { publicId: true },
      });
      const referee = await tx.user.findUniqueOrThrow({
        where: { id: a.refereeUserId },
        select: { publicId: true },
      });
      // The approval is about the referrer's reward; the referrer is its subject-side requester.
      const requester: UserActor = {
        type: 'user',
        userId: a.referrerUserId,
        publicId: referrer.publicId,
        audience: 'customer',
        scopes: [],
      };
      const request = await this.approvals.create(tx, {
        policyKey: POLICY,
        subject: { type: 'referral_attribution', id: a.id, publicId: a.publicId },
        requester,
        amount: rules.referrerRewardBaht,
        flags,
        payload: {
          referralId: a.publicId,
          referrerId: referrer.publicId,
          refereeId: referee.publicId,
          rewardBaht: rules.referrerRewardBaht,
          flags,
          qualifiedThisMonth: thisMonth,
        },
      });
      const row = await tx.referralAttribution.update({
        where: { id: a.id },
        data: { status: 'under_review', fraudFlags: flags, approvalRequestId: request.id },
      });
      await this.record(tx, row, 'referral.review_requested', { flags, approvalId: request.publicId }, actor);
      return;
    }
    await this.qualify(tx, a, now, actor);
  }

  private async qualify(tx: Tx, a: ReferralAttribution, now: Date, actor: Actor): Promise<void> {
    const rules = (await this.settings.at('referral.rules', { at: now })).value;
    const row = await tx.referralAttribution.update({
      where: { id: a.id },
      data: { status: 'qualified', qualifiedAt: now, decidedAt: now },
    });
    const referrer = await tx.user.findUniqueOrThrow({
      where: { id: a.referrerUserId },
      select: { publicId: true },
    });
    const referee = await tx.user.findUniqueOrThrow({
      where: { id: a.refereeUserId },
      select: { publicId: true },
    });
    // Loyalty (B3.4) issues the referrer's points from this event and marks the referral rewarded.
    await this.record(
      tx,
      row,
      'referral.qualified',
      {
        referrerId: referrer.publicId,
        refereeId: referee.publicId,
        rewardBaht: rules.referrerRewardBaht,
      },
      actor,
    );
  }

  @OnDomainEvent(['approval.approved', 'approval.rejected', 'approval.withdrawn', 'approval.expired'], {
    consumer: 'referrals.review',
  })
  async onApprovalOutcome(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['policyKey'] !== POLICY) return;
    const request = await tx.approvalRequest.findUnique({ where: { publicId: event.aggregateId } });
    if (!request) return;
    const a = await tx.referralAttribution.findFirst({
      where: { approvalRequestId: request.id, status: 'under_review' },
    });
    if (!a) return;
    const actor = systemActor('referrals.review');
    if (event.type === 'approval.approved') {
      await this.qualify(tx, a, new Date(), actor);
      return;
    }
    const row = await tx.referralAttribution.update({
      where: { id: a.id },
      data: { status: 'rejected_fraud', decidedAt: new Date() },
    });
    await this.record(tx, row, 'referral.rejected', { flags: a.fraudFlags, review: event.type }, actor);
  }

  // --- helpers ------------------------------------------------------------------------------------------

  private async record(
    tx: Tx,
    a: ReferralAttribution,
    type: string,
    data: Record<string, unknown>,
    actor: Actor,
  ) {
    const event = await this.events.record(
      tx,
      {
        type,
        aggregateType: 'referral_attribution',
        aggregateId: a.publicId,
        payload: { referralId: a.publicId, ...data },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'referral_attribution',
      aggregatePublicId: a.publicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal'],
      domainEventId: event.id,
      actor,
    });
  }
}
