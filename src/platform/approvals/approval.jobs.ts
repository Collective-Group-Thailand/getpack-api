import { systemActor } from '@common/context/actor';
import { PrismaService } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

const BATCH = 200;

/** Expiry (e.g. a discount memo dies with its quote, D-052) and SLA breaches (ADR-0006). */
@Injectable()
export class ApprovalJobs {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  @ScheduledJob({ name: 'approvals.expire', every: 60_000 })
  async expireDue(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.approvalRequest.findMany({
      where: { status: 'pending', expiresAt: { lte: now } },
      include: { policy: { select: { key: true } } },
      take: BATCH,
    });
    const actor = systemActor('approvals.expire');
    for (const request of due) {
      await this.prisma.withTx(async (tx) => {
        const claimed = await tx.approvalRequest.updateMany({
          where: { id: request.id, status: 'pending' },
          data: { status: 'expired', currentStepNo: null, decidedAt: now, rowVersion: { increment: 1 } },
        });
        if (claimed.count === 0) return;
        await tx.approvalRequestStep.updateMany({
          where: { requestId: request.id, status: 'pending' },
          data: { status: 'expired', completedAt: now },
        });
        await this.audit.record(tx, {
          category: 'approval',
          action: 'approval.expired',
          actor,
          entityId: request.entityId,
          resourceType: 'approval_request',
          resourcePublicId: request.publicId,
        });
        await this.events.record(
          tx,
          {
            type: 'approval.expired',
            aggregateType: 'approval_request',
            aggregateId: request.publicId,
            entityId: request.entityId,
            payload: {
              requestId: request.publicId,
              policyKey: request.policy.key,
              subjectType: request.subjectType,
              subjectId: request.subjectPublicId,
              status: 'expired',
            },
          },
          actor,
        );
      });
    }
    return due.length;
  }

  /**
   * One `approval.sla_breached` event per overdue step (notifications route it to the approvers and
   * the escalation role). The event itself marks the breach, so reruns do not repeat it.
   */
  @ScheduledJob({ name: 'approvals.sla', every: 5 * 60_000 })
  async reportSlaBreaches(now: Date = new Date()): Promise<number> {
    const overdue = await this.prisma.$queryRaw<
      {
        request_id: bigint;
        request_public_id: string;
        entity_id: bigint;
        subject_type: string;
        subject_public_id: string;
        policy_key: string;
        step_no: number;
        approver_role: string;
        escalate_to_role: string | null;
        due_at: Date;
      }[]
    >`
      SELECT r.id AS request_id, r.public_id::text AS request_public_id, r.entity_id, r.subject_type,
             r.subject_public_id::text AS subject_public_id, p.key AS policy_key, s.step_no, ar.key AS approver_role,
             er.key AS escalate_to_role, s.due_at
        FROM approval_request_steps s
        JOIN approval_requests r ON r.id = s.request_id AND r.status = 'pending' AND r.current_step_no = s.step_no
        JOIN approval_policies p ON p.id = r.policy_id
        JOIN roles ar ON ar.id = s.approver_role_id
        LEFT JOIN approval_steps t ON t.policy_version_id = r.policy_version_id AND t.step_no = s.step_no
        LEFT JOIN roles er ON er.id = t.escalate_to_role_id
       WHERE s.status = 'pending' AND s.due_at <= ${now}
         AND NOT EXISTS (
           SELECT 1 FROM domain_events e
            WHERE e.type = 'approval.sla_breached' AND e.aggregate_id = r.public_id
              AND (e.payload->>'stepNo')::int = s.step_no)
       LIMIT ${BATCH}`;
    const actor = systemActor('approvals.sla');
    for (const row of overdue) {
      await this.prisma.withTx((tx) =>
        this.events.record(
          tx,
          {
            type: 'approval.sla_breached',
            aggregateType: 'approval_request',
            aggregateId: row.request_public_id,
            entityId: row.entity_id,
            payload: {
              requestId: row.request_public_id,
              policyKey: row.policy_key,
              subjectType: row.subject_type,
              subjectId: row.subject_public_id,
              stepNo: row.step_no,
              approverRole: row.approver_role,
              escalateToRole: row.escalate_to_role,
              dueAt: row.due_at.toISOString(),
            },
          },
          actor,
        ),
      );
    }
    return overdue.length;
  }
}
