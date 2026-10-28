import { systemActor } from '@common/context/actor';
import { addCalendarDays, bangkokDate, startOfBangkokDay } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';
import { holdersOfRole, type Recipient, RecipientDirectory } from '@platform/notifications/recipients';

import { SOLO_OWNER_SETTING, SoloOwnerModeService } from './solo-owner';

/** Aggregate type of the daily digest event; its assignees are the active Superadmins. */
export const SELF_APPROVAL_DIGEST = 'approval_self_approval_digest';
export const SELF_APPROVAL_DIGEST_EVENT = 'approval.self_approval_digest';
/** At most this many self-approvals are itemised in one digest (the count is always complete). */
const MAX_ITEMS = 50;

/**
 * D-449 A (owner decision 2026-10-28, C1d): the daily digest of self-approvals ("อนุมัติด้วยตนเอง") sent to every active
 * Superadmin, and the end of solo-owner mode at its expiry. Both run in the worker.
 */
@Injectable()
export class SelfApprovalDigest implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    private readonly directory: RecipientDirectory,
    private readonly soloOwner: SoloOwnerModeService,
  ) {}

  onModuleInit(): void {
    this.directory.registerAssignees(SELF_APPROVAL_DIGEST, (_event, _route, tx) => this.superadmins(tx));
  }

  async superadmins(tx: Tx): Promise<Recipient[]> {
    const role = await tx.role.findUnique({ where: { key: 'superadmin' }, select: { id: true } });
    return role ? holdersOfRole(tx, role.id, null) : [];
  }

  /**
   * Just after midnight (Asia/Bangkok): one `approval.self_approval_digest` event for the Bangkok day that ended,
   * when it had any self-approval; reruns for the same day do nothing.
   */
  @ScheduledJob({ name: 'approvals.self_approval_digest', cron: '5 0 * * *' })
  async sendDigest(now: Date = new Date()): Promise<number> {
    const day = addCalendarDays(bangkokDate(now), -1);
    const from = startOfBangkokDay(day);
    const to = startOfBangkokDay(bangkokDate(now));
    const where = { selfApproved: true, action: 'approve' as const, createdAt: { gte: from, lt: to } };
    const count = await this.prisma.approvalAction.count({ where });
    if (count === 0) return 0;
    const setting = await this.prisma.setting.findFirst({
      where: { key: SOLO_OWNER_SETTING, scopeType: 'platform', scopeId: null },
      select: { publicId: true },
    });
    if (!setting) return 0;
    const [sent] = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM domain_events
       WHERE type = ${SELF_APPROVAL_DIGEST_EVENT} AND payload->>'day' = ${day}`;
    if (Number(sent?.n ?? 0) > 0) return 0;
    const actions = await this.prisma.approvalAction.findMany({
      where,
      include: {
        actor: { select: { publicId: true, displayName: true } },
        request: { select: { publicId: true, amount: true, policy: { select: { key: true } } } },
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_ITEMS,
    });
    const actor = systemActor('approvals.self_approval_digest');
    await this.prisma.withTx((tx) =>
      this.events.record(
        tx,
        {
          type: SELF_APPROVAL_DIGEST_EVENT,
          aggregateType: SELF_APPROVAL_DIGEST,
          aggregateId: setting.publicId,
          payload: {
            day,
            count,
            items: actions.map((a) => ({
              requestId: a.request.publicId,
              policyKey: a.request.policy.key,
              amount: a.request.amount?.toFixed(2) ?? null,
              approvedBy: a.actor.displayName,
              approvedAt: a.createdAt.toISOString(),
              reason: a.selfApprovalReason,
            })),
          },
        },
        actor,
      ),
    );
    return count;
  }

  /** Every 15 minutes: records solo-owner mode as off once it has expired (D-449 A). */
  @ScheduledJob({ name: 'approvals.solo_owner_mode_expiry', every: 15 * 60_000 })
  async expire(now: Date = new Date()): Promise<boolean> {
    return this.soloOwner.turnOffExpired(now);
  }
}
