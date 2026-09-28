import { systemActor } from '@common/context/actor';
import { MoneyDecimal } from '@common/money/money';
import { bangkokDate } from '@common/time/bangkok';
import { type Tx } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

import { type JournalDraftLine, JournalPostingService } from './journal-posting.service';
import { publicDimensions, swappedLines } from './manual-journals.service';

/**
 * A voided sub-ledger document takes its journals back (§1.2: corrections are reversing entries linked to
 * the original): every posted automatic entry of the source is reversed, dated the day of the void.
 */
@Injectable()
export class SourceReversalSubscriber {
  constructor(private readonly posting: JournalPostingService) {}

  @OnDomainEvent(['customer_document.voided', 'vendor_invoice.voided'], {
    consumer: 'ledger.source_reversal',
  })
  async onVoided(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const type = typeof event.payload['sourceType'] === 'string' ? event.payload['sourceType'] : '';
    const id = typeof event.payload['sourceId'] === 'string' ? event.payload['sourceId'] : '';
    if (!type || !id) return;
    const entries = await tx.journalEntry.findMany({
      where: {
        sourceDocumentType: type,
        sourceDocumentPublicId: id,
        status: 'posted',
        kind: 'auto',
        reversedBy: null,
      },
      include: { lines: true },
    });
    const day = bangkokDate(new Date(event.occurredAt));
    for (const entry of entries) {
      const accounts = new Map(
        (await tx.account.findMany({ where: { id: { in: entry.lines.map((l) => l.accountId) } } })).map(
          (a) => [a.id, a.code],
        ),
      );
      const lines: JournalDraftLine[] = [];
      for (const l of swappedLines(entry.lines)) {
        const debit = new MoneyDecimal(l.debit.toString());
        lines.push({
          accountCode: accounts.get(l.accountId)!,
          side: debit.gt(0) ? 'debit' : 'credit',
          amount: debit.gt(0) ? debit : new MoneyDecimal(l.credit.toString()),
          description: l.description,
          dimensions: await publicDimensions(tx, l),
          taxCode: l.taxCode,
          taxBase: l.taxBaseAmount?.toString() ?? null,
        });
      }
      await this.posting.post(
        tx,
        {
          entityId: entry.entityId,
          kind: 'reversal',
          documentDate: day,
          description: `ยกเลิก ${entry.sourceDocumentNo ?? ''}: กลับรายการ ${entry.entryNo}`,
          reversesEntryId: entry.id,
          source: { type, publicId: id, number: entry.sourceDocumentNo },
          lines,
        },
        systemActor('ledger.source_reversal'),
      );
    }
  }
}
