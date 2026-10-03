import { type Tx } from '@database/prisma.service';
import { type QuoteOutcomeKind } from '@generated/prisma/client';
import { targetGap } from '@modules/pricing/quotes/target-price';
import { Injectable } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

export interface OutcomeExtra {
  orderId?: bigint | null;
  rfqId?: bigint | null;
  leverTakenId?: bigint | null;
  lossReasonId?: bigint | null;
  lossNote?: string | null;
  at?: Date;
}

/**
 * D-250 quote outcomes: one write-once row per saved quotation when it ends — won (converted to an order), lost
 * (declined), expired, converted to RFQ (sent to CS) or revised (a lever taken) — with the target, the gap and the
 * levers. Recorded in the transaction of the change that ends the quotation; `quote.outcome_recorded` feeds the
 * price-gap unmet demand (D-252).
 */
@Injectable()
export class QuoteOutcomesService {
  constructor(private readonly events: DomainEvents) {}

  /** Records the outcome unless one exists (idempotent); true when written. */
  async record(
    tx: Tx,
    quoteId: bigint,
    outcome: QuoteOutcomeKind,
    extra: OutcomeExtra = {},
  ): Promise<boolean> {
    if (await tx.quoteOutcome.findUnique({ where: { quoteId }, select: { id: true } })) return false;
    const quote = await tx.quote.findUniqueOrThrow({
      where: { id: quoteId },
      include: { options: true, _count: { select: { levers: true } } },
    });
    const ordered =
      extra.orderId &&
      (await tx.order.findUnique({ where: { id: extra.orderId }, select: { quoteOptionId: true } }));
    // The ordered quantity when won, else the quantity with the smallest gap (= the lowest unit price).
    const measured =
      (ordered && quote.options.find((o) => o.id === ordered.quoteOptionId)) ||
      [...quote.options].sort((a, b) => a.unitPrice.comparedTo(b.unitPrice) || a.quantity - b.quantity)[0];
    const gap = measured ? targetGap(measured.unitPrice, quote.targetPricePerUnit) : null;
    await tx.quoteOutcome.create({
      data: {
        quoteId,
        outcome,
        occurredAt: extra.at ?? new Date(),
        targetPricePerUnit: quote.targetPricePerUnit,
        quantity: measured?.quantity ?? null,
        unitPrice: measured?.unitPrice ?? null,
        gapPerUnit: gap?.gapPerUnit ?? null,
        gapPct: gap?.gapPct ?? null,
        leversShown: quote._count.levers,
        leverTakenId: extra.leverTakenId ?? null,
        lossReasonId: outcome === 'lost' ? (extra.lossReasonId ?? null) : null,
        lossNote: outcome === 'lost' ? extra.lossNote?.trim() || null : null,
        orderId: extra.orderId ?? null,
        rfqId: extra.rfqId ?? null,
      },
    });
    await this.events.record(tx, {
      type: 'quote.outcome_recorded',
      aggregateType: 'quote',
      aggregateId: quote.publicId,
      payload: {
        quoteId: quote.publicId,
        outcome,
        hasTarget: quote.targetPricePerUnit !== null,
        aboveTarget: gap ? !gap.meetsTarget : false,
        leversShown: quote._count.levers,
        leverTaken: Boolean(extra.leverTakenId),
      },
    });
    return true;
  }

  /** D-250 won: a quotation converted to an order (checkout or CS). */
  @OnDomainEvent('quote.converted', { consumer: 'quotes.outcome-won' })
  async onConverted(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const quote = await tx.quote.findUnique({
      where: { publicId: String(event.payload['quoteId']) },
      select: { id: true, convertedAt: true },
    });
    if (!quote) return;
    const order = await tx.order.findFirst({
      where: { quoteId: quote.id },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    if (!order) return;
    await this.record(tx, quote.id, 'won', { orderId: order.id, at: quote.convertedAt ?? undefined });
  }

  /** D-250 expired: the price lock ran out (D-051). */
  @OnDomainEvent('quote.expired', { consumer: 'quotes.outcome-expired' })
  async onExpired(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const quote = await tx.quote.findUnique({
      where: { publicId: String(event.payload['quoteId']) },
      select: { id: true, validUntil: true },
    });
    if (quote) await this.record(tx, quote.id, 'expired', { at: quote.validUntil });
  }
}
