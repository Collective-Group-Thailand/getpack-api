import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService, type Tx } from '@database/prisma.service';
import {
  type ApprovalScopeRule,
  type CalendarBasis,
  type ConfigVersionStatus,
  Prisma,
} from '@generated/prisma/client';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

import { ApprovalsService } from './approvals.service';
import { conditionProblems } from './conditions';
import { conditionUsesAmount } from './solo-owner';

const POLICY = 'approval_policy_change';
/** A proposal may start a little in the past (clock skew); never backdated further. */
const BACKDATE_SLACK_MS = 5 * 60_000;

export const VERSION_INCLUDE = {
  steps: {
    orderBy: { stepNo: 'asc' },
    include: { approverRole: { select: { key: true } }, escalateToRole: { select: { key: true } } },
  },
  approvalRequest: { select: { publicId: true } },
  createdBy: { select: { publicId: true, displayName: true } },
} as const satisfies Prisma.ApprovalPolicyVersionInclude;
export type PolicyVersionRow = Prisma.ApprovalPolicyVersionGetPayload<{ include: typeof VERSION_INCLUDE }>;

export interface ProposedStep {
  name: string;
  approverRole: string;
  approverScope?: ApprovalScopeRule;
  condition?: unknown;
  quorum?: number;
  slaMinutes?: number | null;
  slaCalendar?: CalendarBasis;
  escalateToRole?: string | null;
}

/**
 * Approval-policy versions (D-063; B6.3 launch gap): staff with `approval_policies.manage` propose a new version of a
 * policy (its steps, conditions and approver roles), routed through `approval_policy_change` (a Superadmin
 * approves; the proposer never approves). Once approved it applies from its `effectiveFrom`; the running version is
 * never edited in place (decided versions and their steps are frozen by the database).
 * D-449 B (C1d): a version may carry `autoApproveMaxAmount` — requests at or below it are approved at creation. Only a
 * version with an amount condition may carry one, and only a Superadmin sets, changes or removes it; omitted, the
 * value in force is carried over.
 */
@Injectable()
export class ApprovalPoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly permissions: PermissionResolver,
  ) {}

  async list() {
    const now = new Date();
    const policies = await this.prisma.approvalPolicy.findMany({
      include: { versions: { include: VERSION_INCLUDE, orderBy: { versionNo: 'desc' } } },
      orderBy: { key: 'asc' },
    });
    return policies.map((p) => ({
      policy: p,
      current:
        p.versions
          .filter((v) => v.status === 'approved' && v.effectiveFrom <= now)
          .sort(
            (a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime() || b.versionNo - a.versionNo,
          )[0] ?? null,
      upcoming: p.versions.find((v) => v.status === 'approved' && v.effectiveFrom > now) ?? null,
      pending: p.versions.find((v) => v.status === 'proposed') ?? null,
    }));
  }

  async versions(policyPublicId: string) {
    const policy = await this.prisma.approvalPolicy.findUnique({ where: { publicId: policyPublicId } });
    if (!policy) throw new DomainException('http.not_found');
    return {
      policy,
      versions: await this.prisma.approvalPolicyVersion.findMany({
        where: { policyId: policy.id },
        include: VERSION_INCLUDE,
        orderBy: { versionNo: 'desc' },
      }),
    };
  }

  async propose(
    actor: UserActor,
    policyPublicId: string,
    input: {
      effectiveFrom: Date;
      reason: string;
      steps: ProposedStep[];
      /** Decimal string; null removes it; undefined carries the value in force over. */
      autoApproveMaxAmount?: string | null;
    },
  ): Promise<PolicyVersionRow> {
    const problems = input.steps.flatMap((s, i) =>
      conditionProblems(s.condition ?? null, `steps.${i}.condition`),
    );
    if (problems.length)
      throw new DomainException('validation.failed', {
        errors: problems.map((message) => ({ path: message.split(':')[0]!, code: 'condition', message })),
      });
    if (input.effectiveFrom.getTime() < Date.now() - BACKDATE_SLACK_MS)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'effectiveFrom', code: 'backdated', message: 'now or later' }],
      });
    const roleKeys = [
      ...new Set(
        input.steps.flatMap((s) => [s.approverRole, ...(s.escalateToRole ? [s.escalateToRole] : [])]),
      ),
    ];
    return this.prisma.withTx(async (tx) => {
      const policy = await tx.approvalPolicy.findUnique({ where: { publicId: policyPublicId } });
      if (!policy) throw new DomainException('http.not_found');
      await tx.$queryRaw`SELECT id FROM approval_policies WHERE id = ${policy.id} FOR UPDATE`;
      if (await tx.approvalPolicyVersion.count({ where: { policyId: policy.id, status: 'proposed' } }))
        throw new DomainException('approval.already_pending');
      const roles = await tx.role.findMany({ where: { key: { in: roleKeys } } });
      const missing = roleKeys.filter((k) => !roles.some((r) => r.key === k));
      if (missing.length)
        throw new DomainException('validation.failed', {
          errors: [{ path: 'steps', code: 'role', message: `unknown roles: ${missing.join(', ')}` }],
        });
      const roleId = (key: string) => roles.find((r) => r.key === key)!.id;
      const [last, inForce] = await Promise.all([
        tx.approvalPolicyVersion.findFirst({
          where: { policyId: policy.id },
          orderBy: { versionNo: 'desc' },
        }),
        tx.approvalPolicyVersion.findFirst({
          where: { policyId: policy.id, status: 'approved', effectiveFrom: { lte: new Date() } },
          orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
        }),
      ]);
      const inForceMax = inForce?.autoApproveMaxAmount?.toFixed(2) ?? null;
      const autoApproveMaxAmount =
        input.autoApproveMaxAmount === undefined
          ? inForceMax
          : input.autoApproveMaxAmount === null
            ? null
            : new Prisma.Decimal(input.autoApproveMaxAmount).toFixed(2);
      if (autoApproveMaxAmount !== inForceMax) {
        const roles = (await this.permissions.forUser(actor.userId)).roles.map((r) => r.key);
        if (!roles.includes('superadmin')) throw new DomainException('approval.threshold_superadmin_only');
      }
      if (autoApproveMaxAmount !== null && !input.steps.some((s) => conditionUsesAmount(s.condition)))
        throw new DomainException('validation.failed', {
          errors: [
            {
              path: 'autoApproveMaxAmount',
              code: 'amountCondition',
              message: 'only a policy whose steps have an amount condition may auto-approve below an amount',
            },
          ],
        });
      const version = await tx.approvalPolicyVersion.create({
        data: {
          policyId: policy.id,
          autoApproveMaxAmount,
          versionNo: (last?.versionNo ?? 0) + 1,
          effectiveFrom: input.effectiveFrom,
          status: 'proposed',
          // The expiry rule couples a policy to its module (e.g. quote validity): carried over, not edited here.
          expiryRule: inForce?.expiryRule ?? Prisma.DbNull,
          onNoMatch: 'fail_closed',
          reason: input.reason,
          createdById: actor.userId,
          steps: {
            create: input.steps.map((s, i) => ({
              stepNo: i + 1,
              name: s.name,
              approverRoleId: roleId(s.approverRole),
              approverScope: s.approverScope ?? 'platform',
              condition:
                s.condition === undefined || s.condition === null
                  ? Prisma.DbNull
                  : (s.condition as Prisma.InputJsonValue),
              quorum: s.quorum ?? 1,
              slaMinutes: s.slaMinutes ?? null,
              slaCalendar: s.slaCalendar ?? 'business',
              escalateToRoleId: s.escalateToRole ? roleId(s.escalateToRole) : null,
            })),
          },
        },
      });
      const request = await this.approvals.create(tx, {
        policyKey: POLICY,
        subject: { type: 'approval_policy_version', id: version.id, publicId: policy.publicId },
        requester: actor,
        payload: {
          policy: policy.key,
          versionNo: version.versionNo,
          effectiveFrom: input.effectiveFrom.toISOString(),
          reason: input.reason,
          autoApproveMaxAmount,
          steps: input.steps.map((s) => ({
            name: s.name,
            role: s.approverRole,
            condition: s.condition ?? null,
          })),
        },
      });
      await tx.approvalPolicyVersion.update({
        where: { id: version.id },
        data: { approvalRequestId: request.id },
      });
      await this.record(tx, actor, policy.publicId, 'approval_policy.version_proposed', {
        policy: policy.key,
        versionNo: version.versionNo,
        approvalId: request.publicId,
        autoApproveMaxAmount,
      });
      return tx.approvalPolicyVersion.findUniqueOrThrow({
        where: { id: version.id },
        include: VERSION_INCLUDE,
      });
    });
  }

  @OnDomainEvent(['approval.approved', 'approval.rejected', 'approval.withdrawn', 'approval.expired'], {
    consumer: 'approvals.policy-versions',
  })
  async onApprovalOutcome(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['policyKey'] !== POLICY) return;
    const request = await tx.approvalRequest.findUnique({ where: { publicId: event.aggregateId } });
    if (!request) return;
    const version = await tx.approvalPolicyVersion.findFirst({
      where: { approvalRequestId: request.id, status: 'proposed' },
      include: { policy: true },
    });
    if (!version) return; // idempotent
    const status: ConfigVersionStatus =
      event.type === 'approval.approved'
        ? 'approved'
        : event.type === 'approval.withdrawn'
          ? 'withdrawn'
          : 'rejected';
    await tx.approvalPolicyVersion.update({
      where: { id: version.id },
      data: { status, decidedAt: new Date(), decidedById: null },
    });
    await this.events.record(tx, {
      type: `approval_policy.version_${status}`,
      aggregateType: 'approval_policy',
      aggregateId: version.policy.publicId,
      payload: { policy: version.policy.key, versionNo: version.versionNo, approvalId: event.aggregateId },
    });
  }

  private async record(
    tx: Tx,
    actor: UserActor,
    policyPublicId: string,
    type: string,
    data: Record<string, unknown>,
  ) {
    await this.audit.record(tx, {
      category: 'approval',
      action: type,
      actor,
      resourceType: 'approval_policy',
      resourcePublicId: policyPublicId,
      data,
    });
    await this.events.record(
      tx,
      { type, aggregateType: 'approval_policy', aggregateId: policyPublicId, payload: data },
      actor,
    );
  }
}
