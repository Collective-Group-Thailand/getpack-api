import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type ClaimLiability,
  type ClaimSeverity,
  type ClaimType,
  type ConfigVersionStatus,
  type GuaranteeRemedy,
  type Prisma,
} from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { ApprovalsService } from '@platform/approvals/approvals.service';
import { AuditService } from '@platform/audit/audit.service';
import { BusinessCalendarService } from '@platform/calendar/business-calendar.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { SettingsService } from '@platform/settings/settings.service';

const POLICY = 'guarantee_policy_change';
const SUBJECT = 'guarantee_policy_version';

export const GUARANTEE_INCLUDE = {
  rules: { orderBy: [{ claimType: 'asc' }, { severity: 'asc' }] },
  approvalRequest: { select: { publicId: true } },
  createdBy: { select: { publicId: true, displayName: true } },
} satisfies Prisma.GuaranteePolicyVersionInclude;
export type GuaranteeVersionRow = Prisma.GuaranteePolicyVersionGetPayload<{
  include: typeof GUARANTEE_INCLUDE;
}>;

/** D-083 / D-260: liabilities on Packio's side get the matrix; the customer's get no remedy. */
const PACKIO_SIDE: ClaimLiability[] = ['factory', 'carrier', 'packio'];

/**
 * The published guarantee (U2.5, D-198–D-200, D-260–D-263): effective-dated policy versions with the remedy matrix and
 * the claim SLAs. The public page and the claim engine read the same version; a new one is drafted by the CS Lead and
 * applies once C-Level approves it (`guarantee_policy_change`), never backwards.
 */
@Injectable()
export class GuaranteeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
    private readonly calendars: BusinessCalendarService,
    private readonly settings: SettingsService,
    private readonly events: DomainEvents,
    private readonly audit: AuditService,
  ) {}

  /** The approved version in force at `at` (null before any — the seed provides version 1). */
  async current(at = new Date(), db: Tx = this.prisma): Promise<GuaranteeVersionRow | null> {
    return db.guaranteePolicyVersion.findFirst({
      where: { status: 'approved', effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      include: GUARANTEE_INCLUDE,
    });
  }

  async list(): Promise<GuaranteeVersionRow[]> {
    return this.prisma.guaranteePolicyVersion.findMany({
      include: GUARANTEE_INCLUDE,
      orderBy: { versionNo: 'desc' },
    });
  }

  async get(publicId: string, db: Tx = this.prisma): Promise<GuaranteeVersionRow> {
    const row = await db.guaranteePolicyVersion.findUnique({
      where: { publicId },
      include: GUARANTEE_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  /** D-261: the remedies a version allows for a claim (none for a customer-liable one, D-083). */
  allowed(
    version: {
      rules: { claimType: ClaimType; severity: ClaimSeverity; remedies: GuaranteeRemedy[] }[];
    } | null,
    claimType: ClaimType,
    severity: ClaimSeverity,
    liability: ClaimLiability,
  ): GuaranteeRemedy[] {
    if (!version || !PACKIO_SIDE.includes(liability)) return [];
    return version.rules.find((r) => r.claimType === claimType && r.severity === severity)?.remedies ?? [];
  }

  /** D-263: `start` + N business days, a business day being one business-hours window (D-161, D-175). */
  async addBusinessDays(start: Date, days: number): Promise<Date> {
    const window = (await this.settings.at('calendar.business_hours', { at: start })).value;
    const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
    const perDay = minutes(window.to) - minutes(window.from);
    const calendar = await this.calendars.calendar();
    return calendar.addBusinessMinutes(start, days * perDay, window);
  }

  /** The CS Lead drafts a new version; it goes to C-Level at once (D-200). One version in approval at a time. */
  async propose(
    actor: UserActor,
    input: {
      effectiveFrom: string;
      responseBusinessDays: number;
      decisionBusinessDays: number;
      reason: string;
      rules: { claimType: ClaimType; severity: ClaimSeverity; remedies: GuaranteeRemedy[] }[];
    },
  ): Promise<GuaranteeVersionRow> {
    const effectiveFrom = new Date(input.effectiveFrom);
    if (effectiveFrom.getTime() < Date.now() - 60_000)
      throw new DomainException('validation.failed', {
        errors: [
          { path: 'effectiveFrom', code: 'past', message: 'a guarantee version never applies backwards' },
        ],
      });
    const keys = input.rules.map((r) => `${r.claimType}:${r.severity}`);
    if (new Set(keys).size !== keys.length)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'rules', code: 'unique', message: 'one rule per claim type and severity' }],
      });
    if (input.rules.some((r) => r.remedies.includes('goodwill')))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'rules', code: 'goodwill', message: 'goodwill is outside the matrix (D-262)' }],
      });
    return this.prisma.withTx(async (tx) => {
      if (await tx.guaranteePolicyVersion.count({ where: { status: 'proposed' } }))
        throw new DomainException('guarantee.version_pending');
      const last = await tx.guaranteePolicyVersion.findFirst({ orderBy: { versionNo: 'desc' } });
      const created = await tx.guaranteePolicyVersion.create({
        data: {
          versionNo: (last?.versionNo ?? 0) + 1,
          effectiveFrom,
          status: 'draft',
          responseBusinessDays: input.responseBusinessDays,
          decisionBusinessDays: input.decisionBusinessDays,
          reason: input.reason.trim(),
          createdById: actor.userId,
          rules: {
            create: input.rules.map((r) => ({
              claimType: r.claimType,
              severity: r.severity,
              remedies: [...new Set(r.remedies)],
            })),
          },
        },
      });
      const request = await this.approvals.create(tx, {
        policyKey: POLICY,
        subject: { type: SUBJECT, id: created.id, publicId: created.publicId },
        requester: actor,
        payload: {
          versionNo: created.versionNo,
          effectiveFrom: effectiveFrom.toISOString(),
          responseBusinessDays: input.responseBusinessDays,
          decisionBusinessDays: input.decisionBusinessDays,
          rules: input.rules.length,
          reason: input.reason,
        },
      });
      await tx.guaranteePolicyVersion.update({
        where: { id: created.id },
        data: { status: 'proposed', approvalRequestId: request.id },
      });
      await this.audit.record(tx, {
        category: 'config',
        action: 'guarantee_policy.proposed',
        actor,
        resourceType: 'guarantee_policy_version',
        resourcePublicId: created.publicId,
        data: {
          versionNo: created.versionNo,
          effectiveFrom: effectiveFrom.toISOString(),
          reason: input.reason,
        },
      });
      await this.record(tx, created.publicId, 'guarantee_policy.version_proposed', {
        versionNo: created.versionNo,
        approvalRequestId: request.publicId,
      });
      return this.get(created.publicId, tx);
    });
  }

  /** The requester withdraws a version in approval. */
  async withdraw(actor: UserActor, publicId: string, reason: string): Promise<GuaranteeVersionRow> {
    return this.prisma.withTx(async (tx) => {
      const version = await this.get(publicId, tx);
      if (version.status !== 'proposed' || !version.approvalRequest)
        throw new DomainException('guarantee.version_not_proposed');
      await this.approvals.withdrawInTx(tx, actor, version.approvalRequest.publicId, reason);
      await tx.guaranteePolicyVersion.update({
        where: { id: version.id },
        data: { status: 'withdrawn', decidedAt: new Date() },
      });
      await this.record(tx, version.publicId, 'guarantee_policy.version_withdrawn', {
        versionNo: version.versionNo,
      });
      return this.get(publicId, tx);
    });
  }

  @OnDomainEvent(['approval.approved', 'approval.rejected', 'approval.withdrawn', 'approval.expired'], {
    consumer: 'claims.guarantee-policy',
  })
  async onApprovalOutcome(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['policyKey'] !== POLICY) return;
    const request = await tx.approvalRequest.findUnique({ where: { publicId: event.aggregateId } });
    if (!request) return;
    const version = await tx.guaranteePolicyVersion.findFirst({
      where: { approvalRequestId: request.id, status: 'proposed' },
    });
    if (!version) return;
    const status: ConfigVersionStatus =
      event.type === 'approval.approved'
        ? 'approved'
        : event.type === 'approval.withdrawn'
          ? 'withdrawn'
          : 'rejected';
    const now = new Date();
    // Never retroactive: an effective date that passed while in approval becomes the decision time.
    const effectiveFrom = status === 'approved' && version.effectiveFrom < now ? now : version.effectiveFrom;
    await tx.guaranteePolicyVersion.update({
      where: { id: version.id },
      data: { status, effectiveFrom, decidedAt: now },
    });
    await this.record(tx, version.publicId, `guarantee_policy.version_${status}`, {
      versionNo: version.versionNo,
      effectiveFrom: effectiveFrom.toISOString(),
    });
  }

  private async record(tx: Tx, publicId: string, type: string, payload: Record<string, unknown>) {
    await this.events.record(tx, {
      type,
      aggregateType: 'guarantee_policy_version',
      aggregateId: publicId,
      payload: { versionId: publicId, ...payload },
    });
  }
}
