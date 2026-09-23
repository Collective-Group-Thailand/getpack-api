import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { Prisma } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

export const DELEGATION_INCLUDE = {
  delegator: { select: { publicId: true, displayName: true } },
  delegate: { select: { publicId: true, displayName: true } },
  policy: { select: { key: true } },
} satisfies Prisma.ApprovalDelegationInclude;
export type DelegationDetail = Prisma.ApprovalDelegationGetPayload<{ include: typeof DELEGATION_INCLUDE }>;

/**
 * Explicit, time-boxed, audited delegation of one's approvals (ADR-0006) — e.g. during leave.
 * The delegate approves "on behalf of" the delegator; the delegator's requests stay off limits.
 */
@Injectable()
export class DelegationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async create(
    actor: UserActor,
    input: { delegatePublicId: string; policyKey?: string; validFrom: Date; validTo: Date; reason: string },
  ): Promise<DelegationDetail> {
    if (input.validTo <= input.validFrom || input.validTo <= new Date()) {
      throw new DomainException('approval.delegation_invalid');
    }
    const delegate = await this.prisma.user.findFirst({
      where: { publicId: input.delegatePublicId, kind: 'staff', status: 'active', anonymisedAt: null },
    });
    if (!delegate || delegate.id === actor.userId) throw new DomainException('approval.delegation_invalid');
    const policy = input.policyKey
      ? await this.prisma.approvalPolicy.findUnique({ where: { key: input.policyKey } })
      : null;
    if (input.policyKey && !policy) throw new DomainException('http.not_found');

    return this.prisma.withTx(async (tx) => {
      const delegation = await tx.approvalDelegation.create({
        data: {
          delegatorUserId: actor.userId,
          delegateUserId: delegate.id,
          policyId: policy?.id ?? null,
          validFrom: input.validFrom,
          validTo: input.validTo,
          reason: input.reason,
          createdById: actor.userId,
        },
        include: DELEGATION_INCLUDE,
      });
      await this.audit.record(tx, {
        category: 'approval',
        action: 'approval.delegation_created',
        resourceType: 'approval_delegation',
        resourcePublicId: delegation.publicId,
        data: {
          delegate: delegate.publicId,
          policy: input.policyKey ?? null,
          validFrom: input.validFrom,
          validTo: input.validTo,
        },
      });
      await this.events.record(tx, {
        type: 'approval.delegation_created',
        aggregateType: 'approval_delegation',
        aggregateId: delegation.publicId,
        payload: {
          delegationId: delegation.publicId,
          delegatorId: actor.publicId,
          delegateId: delegate.publicId,
        },
      });
      return delegation;
    });
  }

  async revoke(actor: UserActor, delegationPublicId: string): Promise<DelegationDetail> {
    const delegation = await this.prisma.approvalDelegation.findFirst({
      where: { publicId: delegationPublicId, delegatorUserId: actor.userId },
    });
    if (!delegation) throw new DomainException('http.not_found');
    return this.prisma.withTx(async (tx) => {
      const revoked = await tx.approvalDelegation.update({
        where: { id: delegation.id },
        data: { revokedAt: delegation.revokedAt ?? new Date(), revokedById: actor.userId },
        include: DELEGATION_INCLUDE,
      });
      await this.audit.record(tx, {
        category: 'approval',
        action: 'approval.delegation_revoked',
        resourceType: 'approval_delegation',
        resourcePublicId: revoked.publicId,
      });
      return revoked;
    });
  }

  /** Delegations the actor gave or received. */
  mine(actor: UserActor): Promise<DelegationDetail[]> {
    return this.prisma.approvalDelegation.findMany({
      where: { OR: [{ delegatorUserId: actor.userId }, { delegateUserId: actor.userId }] },
      include: DELEGATION_INCLUDE,
      orderBy: { validFrom: 'desc' },
    });
  }
}
