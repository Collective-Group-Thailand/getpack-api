import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';

import {
  type LineDraft,
  priceOrderLines,
  type QuoteOptionInput,
  shippedPerDestination,
  vatOf,
} from './order-pricing';

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

export interface PreviewDisplay {
  goodsGrossAmount: string;
  discountGrossAmount: string;
  shippingGrossAmount: string;
  vatAmount: string;
  grossAmount: string;
}

/**
 * The checkout summary rows incl. VAT (D-452): each line's gross before its discount is its gross after it plus the
 * discount and the VAT the discount took off (`discountLine`), so goods − discounts + shipping = the order total exactly.
 */
export function previewDisplay(
  lines: readonly Pick<
    LineDraft,
    'lineType' | 'discountAmount' | 'vatRatePct' | 'grossAmount' | 'vatAmount'
  >[],
): PreviewDisplay {
  let goods = D(0);
  let shipping = D(0);
  let discount = D(0);
  let vat = D(0);
  for (const l of lines) {
    const off = D(l.discountAmount).add(vatOf(D(l.discountAmount), l.vatRatePct));
    const before = D(l.grossAmount).add(off);
    if (l.lineType === 'shipping') shipping = shipping.add(before);
    else goods = goods.add(before);
    discount = discount.add(off);
    vat = vat.add(l.vatAmount);
  }
  return {
    goodsGrossAmount: formatMoney(goods),
    discountGrossAmount: formatMoney(discount),
    shippingGrossAmount: formatMoney(shipping),
    vatAmount: formatMoney(vat),
    grossAmount: formatMoney(goods.sub(discount).add(shipping)),
  };
}
