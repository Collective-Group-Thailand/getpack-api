import { formatMoney, MoneyDecimal } from '@common/money/money';
import { toBangkokIso } from '@common/time/bangkok';

import { type AddressSnapshotDto, type CartDto, type CartItemDto } from './carts.dto';
import { type CartItemRow, type CartRow, productGross, type RepriceDiff } from './carts.service';

export function cartItemDto(item: CartItemRow, now = new Date()): CartItemDto {
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
    quantity: item.quantity,
    unitPrice: new MoneyDecimal(item.unitPrice.toString()).toFixed(2),
    productGrossAmount: formatMoney(productGross(item)),
    designFeeAmount: formatMoney(new MoneyDecimal(result.designFeeAmount ?? '0')),
    quoteShippingAmount: item.shippingAmount ? item.shippingAmount.toFixed(2) : null,
    designOption: item.designOption,
    designNote: item.designNote,
    designDocumentId: item.designDocument?.publicId ?? null,
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
  };
}

export function cartDto(cart: CartRow, now = new Date()): CartDto {
  const total = cart.items.reduce((a, i) => a.add(productGross(i)), new MoneyDecimal(0));
  return {
    id: cart.publicId,
    customerId: cart.customer.publicId,
    channel: cart.channel,
    items: cart.items.map((i) => cartItemDto(i, now)),
    productGrossAmount: formatMoney(total),
    codes: cart.codes.map((c) => ({ code: c.code, status: c.status, rejectReason: c.rejectReason })),
    currency: 'THB',
    updatedAt: toBangkokIso(cart.updatedAt),
  };
}
