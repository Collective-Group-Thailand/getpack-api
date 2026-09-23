import { type Tx } from '@database/prisma.service';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { holdersOfRole, type Recipient, RecipientDirectory } from '@platform/notifications/recipients';

/**
 * `assignee` recipients of approval events: whoever may decide the current step — holders of the
 * step's role (in its scope) and their active delegates — never the requester (ADR-0006).
 */
@Injectable()
export class ApprovalRecipients implements OnModuleInit {
  constructor(private readonly directory: RecipientDirectory) {}

  onModuleInit(): void {
    this.directory.registerAssignees('approval_request', (event, _route, tx) => this.approvers(event, tx));
  }

  async approvers(event: DomainEventEnvelope, tx: Tx): Promise<Recipient[]> {
    const request = await tx.approvalRequest.findUnique({ where: { publicId: event.aggregateId } });
    const stepNo =
      typeof event.payload['stepNo'] === 'number' ? event.payload['stepNo'] : request?.currentStepNo;
    if (!request || stepNo === null || stepNo === undefined) return [];
    const step = await tx.approvalRequestStep.findUnique({
      where: { requestId_stepNo: { requestId: request.id, stepNo } },
    });
    if (!step) return [];
    const holders = await holdersOfRole(tx, step.approverRoleId, step.approverScopeId);
    const now = new Date();
    const delegations = await tx.approvalDelegation.findMany({
      where: {
        delegatorUserId: { in: holders.map((h) => h.userId!) },
        revokedAt: null,
        validFrom: { lte: now },
        validTo: { gt: now },
        OR: [{ policyId: null }, { policyId: request.policyId }],
      },
      include: { delegate: true },
    });
    const all = [
      ...holders,
      ...delegations.map((d) => ({
        userId: d.delegate.id,
        locale: d.delegate.locale,
        displayName: d.delegate.displayName,
      })),
    ];
    const unique = new Map(
      all.filter((r) => r.userId !== request.requesterUserId).map((r) => [r.userId!.toString(), r]),
    );
    return [...unique.values()];
  }
}
