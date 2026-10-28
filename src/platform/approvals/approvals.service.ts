import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { parseDecimal } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type ApprovalRequest, Prisma } from '@generated/prisma/client';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { SodService } from '@modules/iam/sod.service';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { BusinessCalendarService } from '@platform/calendar/business-calendar.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { EntitiesService } from '@platform/entities/entities.service';

import { type ConditionContext, evaluateCondition } from './conditions';
import { BELOW_THRESHOLD, belowThreshold, SoloOwnerModeService, TYPED_REASON_MIN_LENGTH } from './solo-owner';

export const APPROVAL_DETAIL_INCLUDE = {
  policy: { select: { key: true } },
  requester: { select: { publicId: true, displayName: true } },
  steps: { include: { approverRole: { select: { key: true } } }, orderBy: { stepNo: 'asc' } },
  actions: {
    include: {
      actor: { select: { publicId: true, displayName: true } },
      onBehalfOf: { select: { publicId: true, displayName: true } },
      requestStep: { select: { stepNo: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.ApprovalRequestInclude;
export type ApprovalDetail = Prisma.ApprovalRequestGetPayload<{ include: typeof APPROVAL_DETAIL_INCLUDE }>;

export interface CreateApprovalInput {
  policyKey: string;
  /** The aggregate the approval is about, owned by the requesting module. */
  subject: { type: string; id: bigint; publicId: string };
  requester: UserActor;
  /** Money as a 2-decimal string (THB). */
  amount?: string;
  /** Percent as a decimal string (10 = 10 %). */
  pct?: string;
  flags?: string[];
  /**
   * What the approvers decide on. Visible to everyone with `approvals.read`: never put data that
   * D-141 restricts (factory cost, margins) here unless every approver role may see it.
   */
  payload: Record<string, unknown>;
  /** Required when the policy version has an `expiry_rule` (e.g. discount memo = quote validity, D-052). */
  expiresAt?: Date;
  /** Scope ids for `subject_factory` / `subject_company` steps. */
  scope?: { factoryId?: bigint; companyId?: bigint };
  entityId?: bigint;
  /** Values that step conditions reference (`{ field, op, ref }`). */
  refs?: Record<string, string | number>;
}

/**
 * Generic approval-matrix engine (ADR-0006). Owning modules create requests and subscribe to the
 * outcome events (`approval.approved`, `approval.rejected`, `approval.withdrawn`, `approval.expired`);
 * the engine never changes their aggregates.
 *
 * - Routing: the policy version in force is evaluated at creation; matching steps are materialised
 *   and run in order. No matching step → the request is refused (fail closed).
 * - Authority: the actor holds the step's role (in the step's scope), or acts for someone who does
 *   through an active delegation.
 * - Controls: the requester never approves (also a DB trigger); one person approves at most one step
 *   of a request (also a unique index); SoD action pairs `<subject>.approve` are checked.
 * - D-449 (owner decisions 2026-10-28, C1d): a Superadmin may decide a step of any staff role; a Superadmin may approve
 *   their own request only under solo-owner mode, with a typed reason, flagged ("อนุมัติด้วยตนเอง") and only when no
 *   other active user could decide the step; a request whose amount is at or below its policy version's
 *   `autoApproveMaxAmount` is approved at creation ("below threshold").
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionResolver,
    private readonly sod: SodService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly entities: EntitiesService,
    private readonly calendars: BusinessCalendarService,
    private readonly soloOwner: SoloOwnerModeService,
  ) {}

  async create(tx: Tx, input: CreateApprovalInput): Promise<ApprovalRequest> {
    const policy = await tx.approvalPolicy.findUnique({ where: { key: input.policyKey } });
    if (!policy) throw new Error(`Unknown approval policy ${input.policyKey}`);
    if (policy.subjectType !== input.subject.type) {
      throw new Error(`Policy ${policy.key} is for ${policy.subjectType}, not ${input.subject.type}`);
    }
    const now = new Date();
    const version = await tx.approvalPolicyVersion.findFirst({
      where: { policyId: policy.id, status: 'approved', effectiveFrom: { lte: now } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      include: { steps: { orderBy: { stepNo: 'asc' } } },
    });
    if (!version) throw new Error(`Approval policy ${policy.key} has no version in force`);
    if (version.expiryRule && !input.expiresAt) {
      throw new Error(
        `Approval policy ${policy.key} needs expiresAt (${JSON.stringify(version.expiryRule)})`,
      );
    }

    const entityId = input.entityId ?? (await this.entities.defaultEntityId());
    const entity = await tx.entity.findUniqueOrThrow({ where: { id: entityId }, select: { code: true } });
    const context: ConditionContext = {
      amount: input.amount ?? null,
      pct: input.pct ?? null,
      flags: input.flags ?? [],
      entity: entity.code,
      payload: input.payload,
      refs: input.refs ?? {},
    };
    const matching = version.steps.filter((step) => evaluateCondition(step.condition, context));
    if (matching.length === 0) throw new DomainException('approval.no_matching_step');

    // D-449 B: at or below the version's auto-approve amount the second approval is skipped.
    const autoApprove = belowThreshold(input.amount, version.autoApproveMaxAmount);
    let request: ApprovalRequest;
    try {
      request = await tx.approvalRequest.create({
        data: {
          entityId,
          policyId: policy.id,
          policyVersionId: version.id,
          subjectType: input.subject.type,
          subjectId: input.subject.id,
          subjectPublicId: input.subject.publicId,
          requesterUserId: input.requester.userId,
          payloadSnapshot: input.payload as Prisma.InputJsonValue,
          amount:
            input.amount !== undefined ? new Prisma.Decimal(parseDecimal(input.amount).toFixed(2)) : null,
          pct: input.pct !== undefined ? new Prisma.Decimal(parseDecimal(input.pct).toFixed(4)) : null,
          flags: input.flags ?? [],
          status: autoApprove ? 'approved' : 'pending',
          autoApprovedReason: autoApprove ? BELOW_THRESHOLD : null,
          currentStepNo: autoApprove ? null : matching[0]!.stepNo,
          expiresAt: input.expiresAt ?? null,
          decidedAt: autoApprove ? now : null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DomainException('approval.already_pending');
      }
      throw error;
    }

    for (const [index, step] of matching.entries()) {
      const scopeId =
        step.approverScope === 'subject_factory'
          ? input.scope?.factoryId
          : step.approverScope === 'subject_company'
            ? input.scope?.companyId
            : step.approverScope === 'subject_entity'
              ? entityId
              : undefined;
      if (step.approverScope !== 'platform' && scopeId === undefined) {
        throw new Error(`Policy ${policy.key} step ${step.stepNo} needs a ${step.approverScope} scope`);
      }
      await tx.approvalRequestStep.create({
        data: {
          requestId: request.id,
          stepNo: step.stepNo,
          approverRoleId: step.approverRoleId,
          approverScopeId: scopeId ?? null,
          quorum: step.quorum,
          // Only the first step's clock starts now; later steps start when they become current.
          dueAt:
            index === 0 && !autoApprove ? await this.dueAt(now, step.slaMinutes, step.slaCalendar) : null,
          ...(autoApprove && { status: 'skipped' as const, completedAt: now }),
        },
      });
    }

    if (autoApprove) {
      const threshold = version.autoApproveMaxAmount!.toFixed(2);
      await this.audit.record(tx, {
        category: 'approval',
        action: 'approval.auto_approved',
        actor: input.requester,
        entityId,
        resourceType: 'approval_request',
        resourcePublicId: request.publicId,
        data: {
          policy: policy.key,
          subjectType: input.subject.type,
          subjectId: input.subject.publicId,
          reason: 'below threshold',
          amount: request.amount?.toFixed(2) ?? null,
          threshold,
          policyVersionNo: version.versionNo,
        },
      });
      await this.events.record(
        tx,
        {
          type: 'approval.approved',
          aggregateType: 'approval_request',
          aggregateId: request.publicId,
          entityId,
          payload: this.eventPayload(request, policy.key, {
            autoApproved: true,
            reason: BELOW_THRESHOLD,
            threshold,
          }),
        },
        input.requester,
      );
      return request;
    }

    await this.audit.record(tx, {
      category: 'approval',
      action: 'approval.requested',
      actor: input.requester,
      entityId,
      resourceType: 'approval_request',
      resourcePublicId: request.publicId,
      data: {
        policy: policy.key,
        subjectType: input.subject.type,
        subjectId: input.subject.publicId,
        steps: matching.map((s) => s.stepNo),
      },
    });
    await this.events.record(
      tx,
      {
        type: 'approval.requested',
        aggregateType: 'approval_request',
        aggregateId: request.publicId,
        entityId,
        payload: this.eventPayload(request, policy.key, { currentStepNo: request.currentStepNo }),
      },
      input.requester,
    );
    return request;
  }

  /**
   * `selfApprovalReason` (D-449 A): a Superadmin approving their own request under solo-owner mode types why; the
   * action is flagged `selfApproved` with the reason, audited (`approval.self_approved`) and evented.
   */
  async approve(
    actor: UserActor,
    requestPublicId: string,
    comment?: string,
    selfApprovalReason?: string,
  ): Promise<ApprovalDetail> {
    await this.prisma.withTx(async (tx) => {
      const { request, step, onBehalfOf, selfApproved } = await this.lockForDecision(
        tx,
        actor,
        requestPublicId,
        selfApprovalReason,
      );
      const alreadyApproved = await tx.approvalAction.count({
        where: { requestId: request.id, actorUserId: actor.userId, action: 'approve' },
      });
      if (alreadyApproved > 0) throw new DomainException('approval.already_acted');
      await this.sod.checkAction(tx, {
        actorUserId: actor.userId,
        action: `${request.subjectType}.approve`,
        subject: { type: request.subjectType, publicId: request.subjectPublicId },
      });
      await tx.approvalAction.create({
        data: {
          requestId: request.id,
          requestStepId: step.id,
          action: 'approve',
          actorUserId: actor.userId,
          onBehalfOfUserId: onBehalfOf ?? null,
          comment: comment ?? null,
          selfApproved,
          selfApprovalReason: selfApproved ? selfApprovalReason!.trim() : null,
        },
      });
      const policyKey = (await tx.approvalPolicy.findUniqueOrThrow({ where: { id: request.policyId } })).key;
      if (selfApproved) {
        await this.recordDecision(tx, actor, request, policyKey, 'approval.self_approved', {
          stepNo: step.stepNo,
          reason: selfApprovalReason!.trim(),
          mode: 'solo_owner',
        });
      }

      const approvals = await tx.approvalAction.count({
        where: { requestStepId: step.id, action: 'approve' },
      });
      if (approvals < step.quorum) {
        await this.recordDecision(
          tx,
          actor,
          request,
          policyKey,
          'approval.step_approval_recorded',
          { stepNo: step.stepNo, approvals, quorum: step.quorum },
          false,
        );
        return;
      }
      const now = new Date();
      await tx.approvalRequestStep.update({
        where: { id: step.id },
        data: { status: 'approved', completedAt: now },
      });
      const next = await tx.approvalRequestStep.findFirst({
        where: { requestId: request.id, status: 'pending', stepNo: { gt: step.stepNo } },
        orderBy: { stepNo: 'asc' },
      });
      if (next) {
        const template = await tx.approvalStep.findFirst({
          where: { policyVersionId: request.policyVersionId, stepNo: next.stepNo },
        });
        await tx.approvalRequestStep.update({
          where: { id: next.id },
          data: {
            dueAt: await this.dueAt(now, template?.slaMinutes ?? null, template?.slaCalendar ?? 'calendar'),
          },
        });
        const updated = await tx.approvalRequest.update({
          where: { id: request.id },
          data: { currentStepNo: next.stepNo, rowVersion: { increment: 1 } },
        });
        await this.recordDecision(tx, actor, updated, policyKey, 'approval.step_approved', {
          stepNo: step.stepNo,
          nextStepNo: next.stepNo,
        });
      } else {
        const updated = await tx.approvalRequest.update({
          where: { id: request.id },
          data: { status: 'approved', currentStepNo: null, decidedAt: now, rowVersion: { increment: 1 } },
        });
        await this.recordDecision(tx, actor, updated, policyKey, 'approval.approved', {
          stepNo: step.stepNo,
          ...(selfApproved && { selfApproved: true }),
        });
      }
    });
    return this.get(requestPublicId);
  }

  async reject(actor: UserActor, requestPublicId: string, comment: string): Promise<ApprovalDetail> {
    await this.prisma.withTx(async (tx) => {
      const { request, step, onBehalfOf } = await this.lockForDecision(tx, actor, requestPublicId);
      const now = new Date();
      await tx.approvalAction.create({
        data: {
          requestId: request.id,
          requestStepId: step.id,
          action: 'reject',
          actorUserId: actor.userId,
          onBehalfOfUserId: onBehalfOf ?? null,
          comment,
        },
      });
      await tx.approvalRequestStep.update({
        where: { id: step.id },
        data: { status: 'rejected', completedAt: now },
      });
      await tx.approvalRequestStep.updateMany({
        where: { requestId: request.id, status: 'pending' },
        data: { status: 'skipped', completedAt: now },
      });
      const updated = await tx.approvalRequest.update({
        where: { id: request.id },
        data: { status: 'rejected', currentStepNo: null, decidedAt: now, rowVersion: { increment: 1 } },
      });
      const policyKey = (await tx.approvalPolicy.findUniqueOrThrow({ where: { id: request.policyId } })).key;
      await this.recordDecision(tx, actor, updated, policyKey, 'approval.rejected', {
        stepNo: step.stepNo,
        comment,
      });
    });
    return this.get(requestPublicId);
  }

  /** Only the requester withdraws, while the request is pending. */
  async withdraw(actor: UserActor, requestPublicId: string, reason: string): Promise<ApprovalDetail> {
    await this.prisma.withTx((tx) => this.withdrawInTx(tx, actor, requestPublicId, reason));
    return this.get(requestPublicId);
  }

  /** `withdraw` inside the caller's transaction, when the subject is withdrawn with it. */
  async withdrawInTx(tx: Tx, actor: UserActor, requestPublicId: string, reason: string): Promise<void> {
    const request = await this.lock(tx, requestPublicId);
    if (request.requesterUserId !== actor.userId) throw new DomainException('approval.not_authorised');
    if (request.status !== 'pending') throw new DomainException('approval.not_pending');
    const now = new Date();
    await tx.approvalAction.create({
      data: { requestId: request.id, action: 'withdraw', actorUserId: actor.userId, comment: reason },
    });
    await tx.approvalRequestStep.updateMany({
      where: { requestId: request.id, status: 'pending' },
      data: { status: 'skipped', completedAt: now },
    });
    const updated = await tx.approvalRequest.update({
      where: { id: request.id },
      data: { status: 'withdrawn', currentStepNo: null, decidedAt: now, rowVersion: { increment: 1 } },
    });
    const policyKey = (await tx.approvalPolicy.findUniqueOrThrow({ where: { id: request.policyId } })).key;
    await this.recordDecision(tx, actor, updated, policyKey, 'approval.withdrawn', { reason });
  }

  async get(requestPublicId: string): Promise<ApprovalDetail> {
    const request = await this.prisma.approvalRequest.findUnique({
      where: { publicId: requestPublicId },
      include: APPROVAL_DETAIL_INCLUDE,
    });
    if (!request) throw new DomainException('http.not_found');
    return request;
  }

  async list(filter: {
    status?: ApprovalRequest['status'];
    policyKey?: string;
    subjectType?: string;
    skip: number;
    take: number;
  }) {
    const where: Prisma.ApprovalRequestWhereInput = {
      ...(filter.status && { status: filter.status }),
      ...(filter.policyKey && { policy: { key: filter.policyKey } }),
      ...(filter.subjectType && { subjectType: filter.subjectType }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.approvalRequest.findMany({
        where,
        include: APPROVAL_DETAIL_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.approvalRequest.count({ where }),
    ]);
    return { rows, total };
  }

  /** Pending requests whose current step this actor may decide (own roles or delegations). */
  async inbox(actor: UserActor): Promise<ApprovalDetail[]> {
    const authorities = await this.authorities(actor);
    if (authorities.length === 0) return [];
    // D-449 A: under solo-owner mode a Superadmin also sees their own pending requests (approving one still needs
    // a typed reason and no other active approver for the step).
    const ownToo = authorities.some((a) => a.anyStaffRole) && (await this.soloOwner.isOn());
    if (authorities.some((a) => a.anyStaffRole)) {
      const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
        SELECT r.id
          FROM approval_requests r
          JOIN approval_request_steps s ON s.request_id = r.id AND s.step_no = r.current_step_no AND s.status = 'pending'
          JOIN roles ro ON ro.id = s.approver_role_id AND ro.audience = 'staff'
         WHERE r.status = 'pending'
           AND (r.requester_user_id <> ${actor.userId} OR ${ownToo})
           AND NOT EXISTS (SELECT 1 FROM approval_actions a
                            WHERE a.request_id = r.id AND a.actor_user_id = ${actor.userId} AND a.action = 'approve')
         ORDER BY r.created_at`;
      if (rows.length === 0) return [];
      return this.prisma.approvalRequest.findMany({
        where: { id: { in: rows.map((r) => r.id) } },
        include: APPROVAL_DETAIL_INCLUDE,
        orderBy: { createdAt: 'asc' },
      });
    }
    const candidates = await this.prisma.$queryRaw<
      { id: bigint; approver_role_id: bigint; approver_scope_id: bigint | null; policy_id: bigint }[]
    >`
      SELECT r.id, s.approver_role_id, s.approver_scope_id, r.policy_id
        FROM approval_requests r
        JOIN approval_request_steps s ON s.request_id = r.id AND s.step_no = r.current_step_no AND s.status = 'pending'
       WHERE r.status = 'pending'
         AND r.requester_user_id <> ${actor.userId}
         AND s.approver_role_id = ANY(${[...new Set(authorities.map((a) => a.roleId))]}::bigint[])
       ORDER BY r.created_at`;
    const ids = candidates
      .filter((c) =>
        authorities.some((a) => this.matches(a, c.approver_role_id, c.approver_scope_id, c.policy_id)),
      )
      .map((c) => c.id);
    if (ids.length === 0) return [];
    const already = new Set(
      (
        await this.prisma.approvalAction.findMany({
          where: { requestId: { in: ids }, actorUserId: actor.userId, action: 'approve' },
          select: { requestId: true },
        })
      ).map((a) => a.requestId),
    );
    return this.prisma.approvalRequest.findMany({
      where: { id: { in: ids.filter((id) => !already.has(id)) } },
      include: APPROVAL_DETAIL_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  // --- internals ------------------------------------------------------------------------------

  private async lock(tx: Tx, requestPublicId: string): Promise<ApprovalRequest> {
    const [row] = await tx.$queryRaw<{ id: bigint }[]>`
      SELECT id FROM approval_requests WHERE public_id = ${requestPublicId}::uuid FOR UPDATE`;
    if (!row) throw new DomainException('http.not_found');
    return tx.approvalRequest.findUniqueOrThrow({ where: { id: row.id } });
  }

  /** Locks the request and checks the actor may decide its current step. */
  private async lockForDecision(
    tx: Tx,
    actor: UserActor,
    requestPublicId: string,
    selfApprovalReason?: string,
  ) {
    const request = await this.lock(tx, requestPublicId);
    if (request.status !== 'pending' || request.currentStepNo === null)
      throw new DomainException('approval.not_pending');
    if (request.expiresAt && request.expiresAt <= new Date()) throw new DomainException('approval.expired');
    const own = request.requesterUserId === actor.userId;
    // Only an approval may be a self-approval; a requester ends their own request by withdrawing it.
    if (own && selfApprovalReason === undefined) throw new DomainException('approval.self_approval');
    const step = await tx.approvalRequestStep.findFirstOrThrow({
      where: { requestId: request.id, stepNo: request.currentStepNo, status: 'pending' },
    });
    const authorities = await this.authorities(actor);
    const roleAudience = await this.roleAudience(tx, step.approverRoleId);
    const authority = authorities.find((a) =>
      this.matches(a, step.approverRoleId, step.approverScopeId, request.policyId, roleAudience),
    );
    if (!authority) throw new DomainException('approval.not_authorised');
    if (authority.onBehalfOf === request.requesterUserId) throw new DomainException('approval.self_approval');
    if (!own) {
      if (selfApprovalReason !== undefined) throw new DomainException('approval.not_self_approval');
      return { request, step, onBehalfOf: authority.onBehalfOf, selfApproved: false };
    }
    // D-449 A: self-approval — a Superadmin, acting as themselves, under solo-owner mode, with a typed reason, and
    // only while nobody else active could decide this step.
    if (!authorities.some((a) => a.anyStaffRole) || authority.onBehalfOf !== undefined)
      throw new DomainException('approval.self_approval');
    if ((selfApprovalReason ?? '').trim().length < TYPED_REASON_MIN_LENGTH)
      throw new DomainException('validation.failed', {
        errors: [
          {
            path: 'selfApprovalReason',
            code: 'minLength',
            message: `at least ${TYPED_REASON_MIN_LENGTH} characters`,
          },
        ],
      });
    if (!(await this.soloOwner.isOn(tx))) throw new DomainException('approval.solo_owner_mode_off');
    if (await this.soloOwner.otherApproverExists(tx, actor.userId, step))
      throw new DomainException('approval.other_approver_exists');
    return { request, step, onBehalfOf: undefined, selfApproved: true };
  }

  private async roleAudience(tx: Tx, roleId: bigint): Promise<string | null> {
    return (
      (await tx.role.findUnique({ where: { id: roleId }, select: { audience: true } }))?.audience ?? null
    );
  }

  /** The (role, scope) pairs the actor may approve for: own grants, then active delegations. */
  private async authorities(actor: UserActor) {
    const own = (await this.permissions.forUser(actor.userId)).roles;
    const roleIds = new Map(
      (await this.prisma.role.findMany({ select: { id: true, key: true } })).map((r) => [r.key, r.id]),
    );
    const result: {
      roleId: bigint;
      scopeId: bigint | null;
      onBehalfOf?: bigint;
      policyId?: bigint | null;
      /** D-449: the actor's own Superadmin grant decides a step of any staff role (never through a delegation). */
      anyStaffRole?: boolean;
    }[] = own.map((r) => ({
      roleId: roleIds.get(r.key)!,
      scopeId: r.scopeId,
      ...(r.key === 'superadmin' && { anyStaffRole: true }),
    }));
    const now = new Date();
    const delegations = await this.prisma.approvalDelegation.findMany({
      where: { delegateUserId: actor.userId, revokedAt: null, validFrom: { lte: now }, validTo: { gt: now } },
    });
    for (const delegation of delegations) {
      for (const role of (await this.permissions.forUser(delegation.delegatorUserId)).roles) {
        result.push({
          roleId: roleIds.get(role.key)!,
          scopeId: role.scopeId,
          onBehalfOf: delegation.delegatorUserId,
          policyId: delegation.policyId,
        });
      }
    }
    return result;
  }

  private matches(
    authority: { roleId: bigint; scopeId: bigint | null; policyId?: bigint | null; anyStaffRole?: boolean },
    roleId: bigint,
    scopeId: bigint | null,
    policyId: bigint,
    roleAudience: string | null = null,
  ): boolean {
    if (authority.anyStaffRole && roleAudience === 'staff') return true;
    if (authority.roleId !== roleId) return false;
    if (scopeId !== null && authority.scopeId !== scopeId) return false;
    return authority.policyId === undefined || authority.policyId === null || authority.policyId === policyId;
  }

  private async dueAt(
    from: Date,
    slaMinutes: number | null,
    basis: 'business' | 'calendar',
  ): Promise<Date | null> {
    if (!slaMinutes) return null;
    if (basis === 'calendar') return new Date(from.getTime() + slaMinutes * 60_000);
    return (await this.calendars.calendar()).addWorkingMinutes(from, slaMinutes);
  }

  private async recordDecision(
    tx: Tx,
    actor: UserActor,
    request: ApprovalRequest,
    policyKey: string,
    type: string,
    extra: Record<string, unknown>,
    emitEvent = true,
  ): Promise<void> {
    await this.audit.record(tx, {
      category: 'approval',
      action: type,
      actor,
      entityId: request.entityId,
      resourceType: 'approval_request',
      resourcePublicId: request.publicId,
      data: {
        policy: policyKey,
        subjectType: request.subjectType,
        subjectId: request.subjectPublicId,
        ...extra,
      },
    });
    if (!emitEvent) return;
    await this.events.record(
      tx,
      {
        type,
        aggregateType: 'approval_request',
        aggregateId: request.publicId,
        entityId: request.entityId,
        payload: this.eventPayload(request, policyKey, extra),
      },
      actor,
    );
  }

  eventPayload(
    request: ApprovalRequest,
    policyKey: string,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      requestId: request.publicId,
      policyKey,
      subjectType: request.subjectType,
      subjectId: request.subjectPublicId,
      status: request.status,
      ...extra,
    };
  }
}
