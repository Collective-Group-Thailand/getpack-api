import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';

/**
 * Order lines of one configuration at checkout (B3.1, schema-design §2.9, accounting-design §2).
 *
 * The product price is the locked quotation (D-051): instant quotations carry VAT-inclusive amounts
 * (legacy per-piece prices incl. VAT), so the product side's VAT is the quotation's VAT minus its own
 * shipping VAT, allocated to the product / design-fee lines in proportion to their gross (remainder on
 * the product line) — the order total equals the quotation exactly. RFQ quotations carry nets. The
 * quotation's own shipping is replaced by shipping priced per destination (its own line, VAT on the
 * line). Customer withholding (P03) applies per line category when the tax profile withholds (D-174).
 */

export type QuoteSourceKind = 'instant' | 'rfq' | 'sample' | 'call_off';

/** Instant quotations and call-off releases carry VAT-inclusive amounts and get shipping per destination. */
export const shippedPerDestination = (source: QuoteSourceKind): boolean =>
  source === 'instant' || source === 'call_off';

export type LineType = 'product' | 'design_fee' | 'structure_design_fee' | 'shipping';
export type WhtCategory = 'hire_of_work' | 'transport' | 'service' | 'none';
export type TaxNature = 'sale_of_goods' | 'hire_of_work';
export type RevenueCategory = 'made_to_order' | 'standard_product' | 'design_service' | 'shipping' | 'mockup';

export interface QuoteOptionInput {
  /**
   * `sample`: a standalone sample quotation (D-254) — priced like an RFQ quotation, from its option. `call_off`: a
   * call-off release (D-290) — VAT-inclusive like an instant quotation, shipping priced per destination.
   */
  source: QuoteSourceKind;
  quantity: number;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  shippingAmount: string | null;
  result: {
    productAmount?: string | null;
    designFeeAmount?: string | null;
    structureDesignFeeAmount?: string | null;
    shippingNetAmount?: string | null;
    shippingVatAmount?: string | null;
  };
}

export interface PricingContext {
  vatPct: string;
  nature: TaxNature;
  /** Revenue category of the product line (made to order vs standard product). */
  productRevenue: 'made_to_order' | 'standard_product' | 'mockup';
  /** Customer withholding rates by category (percent), or null when the customer does not withhold. */
  wht: Record<'hire_of_work' | 'transport' | 'service', string> | null;
}

export interface LineDraft {
  lineType: LineType;
  descriptionTh: string;
  descriptionEn: string;
  quantity: number;
  unitPrice: string;
  netAmount: string;
  discountAmount: string;
  vatRatePct: string;
  vatAmount: string;
  grossAmount: string;
  whtCategory: WhtCategory;
  whtRatePct: string;
  whtAmount: string;
  revenueCategory: RevenueCategory;
  taxNature: TaxNature;
}

export interface Totals {
  netAmount: string;
  discountAmount: string;
  shippingNetAmount: string;
  vatAmount: string;
  grossAmount: string;
  whtAmount: string;
  cashAmount: string;
}

const D = (v: string | number | MoneyValue | null | undefined) => new MoneyDecimal(v?.toString() ?? '0');
const round2 = (v: MoneyValue) => v.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);

const DESCRIPTIONS: Record<LineType, [string, string]> = {
  product: ['สินค้า', 'Product'],
  design_fee: ['ค่าออกแบบกราฟิก', 'Graphic design fee'],
  structure_design_fee: ['ค่าออกแบบโครงสร้าง', 'Structure design fee'],
  shipping: ['ค่าจัดส่ง', 'Shipping'],
};

/** Withholding category of a line: goods sales are not withheld; design is a service; delivery is transport. */
export function whtCategoryOf(lineType: LineType, nature: TaxNature): WhtCategory {
  if (lineType === 'shipping') return 'transport';
  if (lineType === 'design_fee' || lineType === 'structure_design_fee') return 'service';
  return nature === 'hire_of_work' ? 'hire_of_work' : 'none';
}

/** VAT of a VAT-exclusive amount at `pct`, half-up to the satang (line level, accounting-design §1.5). */
export function vatOf(net: MoneyValue, pct: string): MoneyValue {
  return round2(net.mul(pct).div(100));
}

/**
 * The lines of one configuration. `shippingNet` is the destinations' shipping summed (VAT-exclusive)
 * for instant quotations; RFQ quotations keep the shipping they were quoted with.
 */
export function priceOrderLines(
  option: QuoteOptionInput,
  shippingNet: MoneyValue | null,
  ctx: PricingContext,
): LineDraft[] {
  const drafts: { type: LineType; quantity: number; net: MoneyValue; vat: MoneyValue }[] = [];
  const quoteShipGross = D(option.shippingAmount);
  const quoteShipNet = D(option.result.shippingNetAmount);
  const quoteShipVat =
    option.result.shippingVatAmount !== undefined && option.result.shippingVatAmount !== null
      ? D(option.result.shippingVatAmount)
      : quoteShipGross.sub(quoteShipNet);

  if (shippedPerDestination(option.source)) {
    const productSideGross = D(option.grossAmount).sub(quoteShipGross);
    const productSideVat = D(option.vatAmount).sub(quoteShipVat);
    const candidates: { type: LineType; gross: MoneyValue }[] = [
      { type: 'design_fee', gross: D(option.result.designFeeAmount) },
      { type: 'structure_design_fee', gross: D(option.result.structureDesignFeeAmount) },
    ];
    const fees = candidates.filter((f) => f.gross.gt(0));
    let feeGross = D(0);
    let feeVat = D(0);
    const feeDrafts = fees.map((f) => {
      const vat = productSideGross.gt(0) ? round2(productSideVat.mul(f.gross).div(productSideGross)) : D(0);
      feeGross = feeGross.add(f.gross);
      feeVat = feeVat.add(vat);
      return { type: f.type, quantity: 1, net: f.gross.sub(vat), vat };
    });
    const productGross = productSideGross.sub(feeGross);
    const productVat = productSideVat.sub(feeVat);
    drafts.push({
      type: 'product',
      quantity: option.quantity,
      net: productGross.sub(productVat),
      vat: productVat,
    });
    drafts.push(...feeDrafts);
  } else {
    const net = D(option.netAmount).sub(quoteShipNet);
    const vat = D(option.vatAmount).sub(quoteShipVat);
    drafts.push({ type: 'product', quantity: option.quantity, net, vat });
  }

  const perDestination = shippedPerDestination(option.source);
  const shipNet = perDestination ? (shippingNet ?? D(0)) : quoteShipNet;
  const shipVat = perDestination ? vatOf(shipNet, ctx.vatPct) : quoteShipVat;
  if (shipNet.gt(0)) drafts.push({ type: 'shipping', quantity: 1, net: shipNet, vat: shipVat });

  return drafts.map((d) => {
    const whtCategory = whtCategoryOf(d.type, ctx.nature);
    const whtRate = whtCategory === 'none' || !ctx.wht ? D(0) : D(ctx.wht[whtCategory]);
    const wht = round2(d.net.mul(whtRate).div(100));
    const [th, en] = DESCRIPTIONS[d.type];
    return {
      lineType: d.type,
      descriptionTh: th,
      descriptionEn: en,
      quantity: d.quantity,
      unitPrice: d.net.div(d.quantity).toFixed(6),
      netAmount: formatMoney(d.net),
      discountAmount: '0.00',
      vatRatePct: D(ctx.vatPct).toFixed(4),
      vatAmount: formatMoney(d.vat),
      grossAmount: formatMoney(d.net.add(d.vat)),
      whtCategory,
      whtRatePct: whtRate.toFixed(4),
      whtAmount: formatMoney(wht),
      revenueCategory:
        d.type === 'product' ? ctx.productRevenue : d.type === 'shipping' ? 'shipping' : 'design_service',
      taxNature: ctx.nature,
    };
  });
}

/**
 * The line after a further discount of `amount` on its net (promotions, points, memos): VAT falls by the
 * VAT of the discount (so the undiscounted part keeps the quotation's VAT exactly), withholding is
 * recomputed on the discounted net. Never below zero.
 */
export function discountLine(line: LineDraft, amount: MoneyValue | string): LineDraft {
  const net = D(line.netAmount);
  const discount = D(line.discountAmount).add(amount);
  if (discount.gt(net)) throw new RangeError('discount exceeds the line net');
  const vat = MoneyDecimal.max(D(line.vatAmount).sub(vatOf(D(amount), line.vatRatePct)), D(0));
  const base = net.sub(discount);
  return {
    ...line,
    discountAmount: formatMoney(discount),
    vatAmount: formatMoney(vat),
    grossAmount: formatMoney(base.add(vat)),
    whtAmount: formatMoney(round2(base.mul(line.whtRatePct).div(100))),
  };
}

export function totalsOf(lines: readonly LineDraft[]): Totals {
  const sum = (f: (l: LineDraft) => string) => lines.reduce((a, l) => a.add(f(l)), D(0));
  const net = sum((l) => l.netAmount);
  const discount = sum((l) => l.discountAmount);
  const vat = sum((l) => l.vatAmount);
  const gross = net.sub(discount).add(vat);
  const wht = sum((l) => l.whtAmount);
  return {
    netAmount: formatMoney(net),
    discountAmount: formatMoney(discount),
    shippingNetAmount: formatMoney(sum((l) => (l.lineType === 'shipping' ? l.netAmount : '0'))),
    vatAmount: formatMoney(vat),
    grossAmount: formatMoney(gross),
    whtAmount: formatMoney(wht),
    cashAmount: formatMoney(gross.sub(wht)),
  };
}

export function addTotals(all: readonly Totals[]): Totals {
  const keys = [
    'netAmount',
    'discountAmount',
    'shippingNetAmount',
    'vatAmount',
    'grossAmount',
    'whtAmount',
    'cashAmount',
  ] as const;
  return Object.fromEntries(
    keys.map((k) => [k, formatMoney(all.reduce((a, t) => a.add(t[k]), D(0)))]),
  ) as unknown as Totals;
}
