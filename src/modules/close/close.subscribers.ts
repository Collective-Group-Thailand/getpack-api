import { type Tx } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

/** Keeps close checklists in step with the ledger's periods (B5.6). */
@Injectable()
export class CloseSubscribers {
  /** A soft-closed month reopened through the ledger returns its checklist to work. */
  @OnDomainEvent('fiscal_period.status_changed', { consumer: 'close.period_reopened' })
  async onPeriodChanged(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['to'] !== 'open') return;
    const period = await tx.fiscalPeriod.findUnique({ where: { publicId: event.aggregateId } });
    if (!period) return;
    await tx.closeChecklist.updateMany({ where: { fiscalPeriodId: period.id, status: 'in_review' }, data: { status: 'open', submittedAt: null, submittedById: null, rowVersion: { increment: 1 } } });
  }
}
