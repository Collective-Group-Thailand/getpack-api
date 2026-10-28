import { formatMoney, MoneyDecimal } from '@common/money/money';
import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { lineSummary } from '@modules/quotes/line-summary';
import { type ReorderQuantityLimitsDto } from '@modules/quotes/quantity-limits.dto';

import { type AddressSnapshotDto, type CartDto, type CartItemDto, type CartTierHintDto } from './carts.dto';
import { type CartItemRow, type CartRow, productGross, type RepriceDiff } from './carts.service';

/** D-452 (C5): what the cart endpoints add from settings and other rows (see `CartFigures`). */
export interface CartExtras {
  vatAmount: string | null;
  maxCodes: number | null;
  quantityStep: number | null;
  items: ReadonlyMap<
    string,
    { tierHint: CartTierHintDto | null; quantityLimits: ReorderQuantityLimitsDto | null }
  >;
}

/** An item's quantity can change in the cart (D-452): instant, no Studio pin, not a reorder, nothing to confirm. */
export function quantityEditable(item: CartItemRow): boolean {
  return (
    item.quote.source === 'instant' &&
    item.quote.designDocumentVersionId === null &&
    item.reorderOfOrderId === null &&
    item.pendingQuoteOptionId === null
  );
}

/** The quotation's earliest ship date (Bangkok day) while still ahead of today; null otherwise. */
export function shipDateAhead(date: Date | null, now: Date): string | null {
  if (!date) return null;
  const day = date.toISOString().slice(0, 10);
  return day >= bangkokDate(now) ? day : null;
}

export function cartItemDto(item: CartItemRow, now = new Date(), extras?: CartExtras): CartItemDto {
  const extra = extras?.items.get(item.publicId);
  const result = (item.quoteOption.result ?? {}) as { designFeeAmount?: string };
  const diff = item.pendingPriceDiff as RepriceDiff | null;
  const covered = item.destinations.reduce((a, d) => a + d.quantity, 0);
  return {
    id: item.publicId,
    quoteId: item.quote.publicId,
    quoteOptionId: item.quoteOption.publicId,
    quoteCode: item.quote.quoteCode,
    source: item.quote.source,
    productTypeCode: item.quote.productType.code,
    summary: lineSummary(item.quote, item.quoteOption.unit),
    quantity: item.quantity,
    unitPrice: new MoneyDecimal(item.unitPrice.toString()).toFixed(2),
    productGrossAmount: formatMoney(productGross(item)),
    designFeeAmount: formatMoney(new MoneyDecimal(result.designFeeAmount ?? '0')),
    quoteShippingAmount: item.shippingAmount ? item.shippingAmount.toFixed(2) : null,
    designOption: item.designOption,
    designNote: item.designNote,
    designDocumentId: item.designDocument?.publicId ?? null,
    designVersionNo: item.designDocumentVersion?.versionNo ?? null,
    mockupOption: item.mockupOption,
    reorderOf: item.reorderOfOrder
      ? { orderId: item.reorderOfOrder.publicId, orderCode: item.reorderOfOrder.orderCode }
      : null,
    reusesApprovedArtwork: item.reuseArtworkProofId !== null,
    priceLockedUntil: toBangkokIso(item.priceLockedUntil),
    priceLocked: item.priceLockedUntil > now,
    pendingReprice:
      diff && item.pendingQuote && item.pendingQuoteOption
        ? {
            quoteId: item.pendingQuote.publicId,
            quoteOptionId: item.pendingQuoteOption.publicId,
            previousGrossAmount: diff.previousGrossAmount,
            newGrossAmount: diff.newGrossAmount,
            differenceAmount: diff.differenceAmount,
            newUnitPrice: diff.newUnitPrice,
            validUntil: toBangkokIso(new Date(diff.validUntil)),
          }
        : null,
    destinations: item.destinations.map((d) => ({
      id: d.publicId,
      addressId: d.customerAddress?.publicId ?? null,
      address: d.addressSnapshot as unknown as AddressSnapshotDto,
      quantity: d.quantity,
    })),
    destinationsComplete: covered === item.quantity,
    quantityEditable: quantityEditable(item),
    quantityLimits: extra?.quantityLimits ?? null,
    tierHint: extra?.tierHint ?? null,
    earliestShipDate: shipDateAhead(item.quoteOption.earliestShipDate, now),
    leadTimeDays: item.quoteOption.leadTimeDays,
  };
}

export function cartDto(cart: CartRow, now = new Date(), extras?: CartExtras): CartDto {
  const total = cart.items.reduce((a, i) => a.add(productGross(i)), new MoneyDecimal(0));
  return {
    id: cart.publicId,
    customerId: cart.customer.publicId,
    channel: cart.channel,
    items: cart.items.map((i) => cartItemDto(i, now, extras)),
    productGrossAmount: formatMoney(total),
    vatAmount: extras?.vatAmount ?? null,
    maxCodes: extras?.maxCodes ?? null,
    quantityStep: extras?.quantityStep ?? null,
    codes: cart.codes.map((c) => ({ code: c.code, status: c.status, rejectReason: c.rejectReason })),
    currency: 'THB',
    updatedAt: toBangkokIso(cart.updatedAt),
  };
}
