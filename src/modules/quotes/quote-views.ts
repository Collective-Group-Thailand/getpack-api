import { toBangkokIso } from '@common/time/bangkok';
import { type QuoteStepView } from '@modules/pricing/quotes/quote-engine.service';
import { targetGap, targetString } from '@modules/pricing/quotes/target-price';

import { type QuoteLeverDto, type QuoteLeversDto } from './levers/levers.dto';
import { type LeverSet } from './levers/quote-levers.service';
import { lineSummary } from './line-summary';
import { type AdminSavedQuoteDto, type SavedQuoteDto, type SavedQuoteOptionDto } from './quotes.dto';
import { type QuoteRow } from './saved-quotes.service';

type StepResult = Omit<QuoteStepView, 'internal'>;
type Internal = NonNullable<QuoteStepView['internal']>;

const pdfStatus = (q: QuoteRow) => (q.pdfFileId ? 'ready' : q.pdfRequestedAt ? 'pending' : 'none');

function option(o: QuoteRow['options'][number], target: QuoteRow['targetPricePerUnit']): SavedQuoteOptionDto {
  const r = o.result as unknown as StepResult;
  return {
    id: o.publicId,
    quantity: o.quantity,
    unitPrice: r.unitPrice ?? o.unitPrice.toFixed(2),
    productAmount: r.productAmount ?? o.netAmount.toFixed(2),
    designFeeAmount: r.designFeeAmount ?? '0.00',
    structureDesignFeeAmount: r.structureDesignFeeAmount ?? '0.00',
    toolingAmount: r.toolingAmount ?? null,
    shippingAmount: o.shippingAmount?.toFixed(2) ?? null,
    vatAmount: o.vatAmount.toFixed(2),
    netAmount: o.netAmount.toFixed(2),
    grossAmount: o.grossAmount.toFixed(2),
    leadTimeDays: o.leadTimeDays,
    earliestShipDate: r.earliestShipDate ?? null,
    earliestDeliveryDate: r.earliestDeliveryDate ?? null,
    toleranceShortagePct: o.toleranceShortagePct?.toFixed(4) ?? null,
    toleranceOveragePct: o.toleranceOveragePct?.toFixed(4) ?? null,
    toleranceDimensionalMm: o.toleranceDimensionalMm?.toFixed(2) ?? null,
    toleranceColourDeltaE: o.toleranceColourDeltaE?.toFixed(2) ?? null,
    shippingPending: r.shippingPending ?? o.shippingAmount === null,
    shippingPendingReason: r.shippingPendingReason ?? null,
    targetGap: targetGap(o.unitPrice, target),
  };
}

/** The customer view: no factory, buy price or margin (D-050). */
export function quoteDto(q: QuoteRow, now = new Date()): SavedQuoteDto {
  const input = q.input as {
    configuration?: unknown;
    deliveryPostcode?: string | null;
    dimensions?: SavedQuoteDto['dimensions'];
  };
  return {
    id: q.publicId,
    quoteCode: q.quoteCode,
    status: q.status,
    source: q.source,
    productTypeCode: q.productType.code,
    summary: lineSummary(q, q.options[0]?.unit ?? 'piece'),
    configuration: (q.source === 'instant'
      ? (input.configuration ?? null)
      : null) as SavedQuoteDto['configuration'],
    deliveryPostcode: q.deliveryPostcode,
    validUntil: toBangkokIso(q.validUntil),
    priceLocked: ['saved', 'shared'].includes(q.status) && q.validUntil > now,
    options: q.options.map((o) => option(o, q.targetPricePerUnit)),
    pdfStatus: pdfStatus(q),
    currency: 'THB',
    sharedAt: q.sharedAt ? toBangkokIso(q.sharedAt) : null,
    shareExpiresAt: q.shareExpiresAt ? toBangkokIso(q.shareExpiresAt) : null,
    dimensions: input.dimensions ?? null,
    advisory:
      q.advisoryRecommendation && q.advisoryChoice
        ? { recommendationId: q.advisoryRecommendation.publicId, choiceId: q.advisoryChoice.publicId }
        : null,
    targetPricePerUnit: targetString(q.targetPricePerUnit),
    outcome: q.outcome
      ? {
          outcome: q.outcome.outcome,
          occurredAt: toBangkokIso(q.outcome.occurredAt),
          lossReasonCode: q.outcome.lossReason?.code ?? null,
          leverTakenId: q.outcome.leverTaken?.publicId ?? null,
        }
      : null,
    fromLever: q.fromLever ? { leverId: q.fromLever.publicId, quoteId: q.fromLever.quote.publicId } : null,
    createdAt: toBangkokIso(q.createdAt),
  };
}

/** The staff view; buy prices need `factory_cost.read`, margins `margin.read` (D-141). */
export function adminQuoteDto(q: QuoteRow, grants: { cost: boolean; margin: boolean }): AdminSavedQuoteDto {
  const base = quoteDto(q);
  return {
    ...base,
    channel: q.channel,
    customer: q.customer ? { id: q.customer.publicId, displayName: q.customer.displayName } : null,
    createdBy: q.createdBy ? { id: q.createdBy.publicId, displayName: q.createdBy.displayName } : null,
    customerCode: q.customer?.customerProfile?.customerCode ?? null,
    rfq: q.rfqQuote ? { id: q.rfqQuote.rfq.publicId, rfqCode: q.rfqQuote.rfq.rfqCode } : null,
    note: q.staffNote,
    options: q.options.map((o, i) => {
      const internal = o.internalBreakdown as unknown as Internal | null;
      return {
        ...base.options[i]!,
        internal: internal && {
          ...internal,
          buyPrice: grants.cost ? internal.buyPrice : null,
          marginPct: grants.margin ? internal.marginPct : null,
          parts: internal.parts.map((p) => ({ ...p, buyPrice: grants.cost ? p.buyPrice : null })),
          shipping: internal.shipping && {
            ...internal.shipping,
            costAmount: grants.cost ? internal.shipping.costAmount : null,
            marginAmount: grants.margin ? internal.shipping.marginAmount : null,
          },
        },
      };
    }),
  };
}

/** D-248 levers of a quotation (the customer's own configuration; never a factory). */
export function leverSetDto(set: LeverSet): QuoteLeversDto {
  return {
    quoteId: set.quote.publicId,
    targetPricePerUnit: targetString(set.quote.targetPricePerUnit)!,
    status: set.status,
    computedAt: set.quote.leversComputedAt ? toBangkokIso(set.quote.leversComputedAt) : null,
    levers: set.levers.map((l) => ({
      id: l.publicId,
      rank: l.rank,
      kind: l.kind,
      reasonCodes: l.reasonCodes as QuoteLeverDto['reasonCodes'],
      changes: l.changes as Record<string, unknown>,
      configuration: l.configuration as Record<string, unknown>,
      steps: l.steps as unknown as QuoteLeverDto['steps'],
      bestSavingPct: l.bestSavingPct.toFixed(4),
      validUntil: toBangkokIso(l.validUntil),
      takenQuoteId: l.takenBy?.publicId ?? null,
    })),
  };
}
