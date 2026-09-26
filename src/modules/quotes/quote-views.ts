import { toBangkokIso } from '@common/time/bangkok';
import { type QuoteStepView } from '@modules/pricing/quotes/quote-engine.service';

import { type AdminSavedQuoteDto, type SavedQuoteDto, type SavedQuoteOptionDto } from './quotes.dto';
import { type QuoteRow } from './saved-quotes.service';

type StepResult = Omit<QuoteStepView, 'internal'>;
type Internal = NonNullable<QuoteStepView['internal']>;

const pdfStatus = (q: QuoteRow) => (q.pdfFileId ? 'ready' : q.pdfRequestedAt ? 'pending' : 'none');

function option(o: QuoteRow['options'][number]): SavedQuoteOptionDto {
  const r = o.result as unknown as StepResult;
  return {
    id: o.publicId,
    quantity: o.quantity,
    unitPrice: r.unitPrice ?? o.unitPrice.toFixed(2),
    productAmount: r.productAmount ?? o.netAmount.toFixed(2),
    designFeeAmount: r.designFeeAmount ?? '0.00',
    structureDesignFeeAmount: r.structureDesignFeeAmount ?? '0.00',
    shippingAmount: o.shippingAmount?.toFixed(2) ?? null,
    vatAmount: o.vatAmount.toFixed(2),
    netAmount: o.netAmount.toFixed(2),
    grossAmount: o.grossAmount.toFixed(2),
    leadTimeDays: o.leadTimeDays,
    earliestShipDate: r.earliestShipDate ?? null,
    earliestDeliveryDate: r.earliestDeliveryDate ?? null,
    toleranceShortagePct: o.toleranceShortagePct?.toFixed(4) ?? null,
    toleranceOveragePct: o.toleranceOveragePct?.toFixed(4) ?? null,
    shippingPending: r.shippingPending ?? o.shippingAmount === null,
    shippingPendingReason: r.shippingPendingReason ?? null,
  };
}

/** The customer view: no factory, buy price or margin (D-050). */
export function quoteDto(q: QuoteRow, now = new Date()): SavedQuoteDto {
  const input = q.input as { configuration?: unknown; deliveryPostcode?: string | null };
  return {
    id: q.publicId,
    quoteCode: q.quoteCode,
    status: q.status,
    source: q.source,
    productTypeCode: q.productType.code,
    configuration: (q.source === 'instant'
      ? (input.configuration ?? null)
      : null) as SavedQuoteDto['configuration'],
    deliveryPostcode: q.deliveryPostcode,
    validUntil: toBangkokIso(q.validUntil),
    priceLocked: ['saved', 'shared'].includes(q.status) && q.validUntil > now,
    options: q.options.map(option),
    pdfStatus: pdfStatus(q),
    currency: 'THB',
    sharedAt: q.sharedAt ? toBangkokIso(q.sharedAt) : null,
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
