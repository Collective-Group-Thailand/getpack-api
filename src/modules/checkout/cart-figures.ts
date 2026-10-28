import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';

import { priceOrderLines, type QuoteOptionInput, shippedPerDestination } from './order-pricing';

/**
 * D-452 (Stage C block C5): the cart summary's figures, from the same order pricing the checkout uses — never a
 * second calculation. Pure.
 */

const D = (v: string | number | MoneyValue | null | undefined) => new MoneyDecimal(v?.toString() ?? '0');

/**
 * VAT included in one item's goods (product and design fees, without shipping): the order lines checkout builds for
 * the item before any shipping is priced (`priceOrderLines` with no destination shipping; an RFQ quotation's own
 * shipping line left out) — DECISIONS-STAGE-A §7 rounding through the shared VAT helper.
 */
export function goodsVat(option: QuoteOptionInput, vatPct: string): MoneyValue {
  const lines = priceOrderLines(option, shippedPerDestination(option.source) ? D(0) : null, {
    vatPct,
    nature: 'sale_of_goods',
    productRevenue: 'made_to_order',
    wht: null,
  });
  return lines.filter((l) => l.lineType !== 'shipping').reduce((a, l) => a.add(l.vatAmount), D(0));
}

export interface TierOption {
  publicId: string;
  quantity: number;
  /** Per piece incl. VAT (the quotation option's unit price). */
  unitPrice: string;
  grossAmount: string;
  shippingAmount: string | null;
}

export interface TierHint {
  quoteOptionId: string;
  quantity: number;
  unitPrice: string;
  productGrossAmount: string;
}

/**
 * "สั่ง {n} ชิ้น ราคาต่อชิ้นเหลือ ฿x": the smallest quantity of the same locked quotation above the item's whose unit
 * price is lower — a price the pricing service already gave (no new calculation). Null when there is none.
 */
export function tierHintOf(
  options: readonly TierOption[],
  current: { quantity: number; unitPrice: string },
): TierHint | null {
  const unit = D(current.unitPrice);
  const next = [...options]
    .sort((a, b) => a.quantity - b.quantity)
    .find((o) => o.quantity > current.quantity && D(o.unitPrice).lt(unit));
  if (!next) return null;
  return {
    quoteOptionId: next.publicId,
    quantity: next.quantity,
    unitPrice: D(next.unitPrice).toFixed(2),
    productGrossAmount: formatMoney(D(next.grossAmount).sub(D(next.shippingAmount))),
  };
}
