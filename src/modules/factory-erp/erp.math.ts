import { MoneyDecimal, type MoneyValue } from '@common/money/money';

/**
 * Packio Factory ERP arithmetic (D-320, D-321, D-325, D-326) — pure, so the ledger rules are unit tested
 * without a database. Quantities have 3 decimals, unit costs 6, money 2; every rounding is half-up.
 */

export type DecimalLike = string | number | { toString(): string };

export const dec = (value: DecimalLike): MoneyValue => new MoneyDecimal(value.toString());
export const qty3 = (value: MoneyValue): MoneyValue => value.toDecimalPlaces(3);
export const cost6 = (value: MoneyValue): MoneyValue => value.toDecimalPlaces(6);
export const money2 = (value: MoneyValue): MoneyValue => value.toDecimalPlaces(2);

export const fmtQty = (value: DecimalLike): string => dec(value).toFixed(3);
export const fmtCost = (value: DecimalLike): string => dec(value).toFixed(6);
export const fmtMoney = (value: DecimalLike): string => dec(value).toFixed(2);

export interface BalanceState {
  onHand: MoneyValue;
  avgCost: MoneyValue;
  value: MoneyValue;
}

export interface MovementEffect {
  /** Signed base quantity actually posted. */
  quantity: MoneyValue;
  unitCost: MoneyValue;
  /** Signed value of the movement. */
  value: MoneyValue;
  after: BalanceState;
}

/**
 * Posts a signed quantity on a balance (D-321, moving weighted average):
 * - in with a cost (receipt, opening): the average absorbs it — `(value + q·cost) / (onHand + q)`;
 * - in without a cost (return, transfer in, positive adjustment / count): enters at the current average,
 *   or at `fallbackCost` when the balance has no average yet;
 * - out: leaves at the current average; emptying the balance takes its whole remaining value, so no
 *   rounding residue stays behind.
 * A balance that went negative (D-322 relaxed) is re-valued at the incoming cost when it is refilled.
 */
export function applyMovement(
  before: BalanceState,
  quantity: MoneyValue,
  options: { unitCost?: MoneyValue; fallbackCost?: MoneyValue } = {},
): MovementEffect {
  const q = qty3(quantity);
  if (q.isZero()) throw new RangeError('A stock movement needs a non-zero quantity');
  const onHand = qty3(before.onHand.plus(q));

  if (q.isPositive()) {
    const incoming =
      options.unitCost ?? (before.avgCost.gt(0) ? before.avgCost : (options.fallbackCost ?? dec(0)));
    const unitCost = cost6(incoming);
    const value = money2(q.times(unitCost));
    if (before.onHand.lte(0) || onHand.isZero()) {
      return {
        quantity: q,
        unitCost,
        value,
        after: { onHand, avgCost: unitCost, value: money2(onHand.times(unitCost)) },
      };
    }
    const total = before.value.plus(value);
    const avgCost = cost6(total.div(onHand));
    return { quantity: q, unitCost, value, after: { onHand, avgCost, value: money2(total) } };
  }

  const unitCost = cost6(before.avgCost);
  if (onHand.isZero()) {
    return {
      quantity: q,
      unitCost,
      value: before.value.negated(),
      after: { onHand, avgCost: unitCost, value: dec(0) },
    };
  }
  const value = money2(q.times(unitCost));
  const after = onHand.isNegative() ? money2(onHand.times(unitCost)) : money2(before.value.plus(value));
  return { quantity: q, unitCost, value, after: { onHand, avgCost: unitCost, value: after } };
}

/** Base quantity of `quantity` purchase units (`factor` base units each). */
export function toBase(quantity: MoneyValue, factor: MoneyValue): MoneyValue {
  return qty3(quantity.times(factor));
}

/** A purchase-order line amount: quantity × unit price less the line discount, in money. */
export function lineAmount(quantity: MoneyValue, unitPrice: MoneyValue, discountPct: MoneyValue): MoneyValue {
  return money2(quantity.times(unitPrice).times(dec(100).minus(discountPct)).div(100));
}

export type VatMode = 'exclusive' | 'inclusive' | 'none';

export interface DocumentTotals {
  subtotal: MoneyValue;
  vatAmount: MoneyValue;
  total: MoneyValue;
}

/**
 * Document totals from line amounts: `exclusive` adds VAT on the subtotal, `inclusive` takes it out of the
 * total (`total × rate / (100 + rate)`), `none` has no VAT.
 */
export function documentTotals(amounts: MoneyValue[], mode: VatMode, ratePct: MoneyValue): DocumentTotals {
  const sum = money2(amounts.reduce((a, b) => a.plus(b), dec(0)));
  if (mode === 'none') return { subtotal: sum, vatAmount: dec(0), total: sum };
  if (mode === 'exclusive') {
    const vatAmount = money2(sum.times(ratePct).div(100));
    return { subtotal: sum, vatAmount, total: sum.plus(vatAmount) };
  }
  const vatAmount = money2(sum.times(ratePct).div(dec(100).plus(ratePct)));
  return { subtotal: sum.minus(vatAmount), vatAmount, total: sum };
}

/**
 * The stock cost of one purchase unit (D-321): the net price after the line discount, without VAT for a
 * VAT-registered factory (VAT taken out of an inclusive price) and with VAT for one that is not (VAT added to
 * an exclusive price).
 */
export function purchaseUnitCost(
  unitPrice: MoneyValue,
  discountPct: MoneyValue,
  mode: VatMode,
  ratePct: MoneyValue,
  vatRegistered: boolean,
): MoneyValue {
  const net = unitPrice.times(dec(100).minus(discountPct)).div(100);
  if (mode === 'none') return net;
  if (vatRegistered && mode === 'inclusive') return net.times(100).div(dec(100).plus(ratePct));
  if (!vatRegistered && mode === 'exclusive') return net.times(dec(100).plus(ratePct)).div(100);
  return net;
}

/**
 * Reorder suggestion (D-326) in base units: nothing while available stock is above the reorder point;
 * otherwise `max(reorderQty, reorderPoint − available)`, rounded up to whole purchase units.
 */
export function reorderQuantity(
  available: MoneyValue,
  reorderPoint: MoneyValue,
  reorderQty: MoneyValue | null,
  factor: MoneyValue,
): MoneyValue {
  if (available.gt(reorderPoint)) return dec(0);
  const shortfall = reorderPoint.minus(available);
  const wanted = reorderQty && reorderQty.gt(shortfall) ? reorderQty : shortfall;
  const units = wanted.div(factor).ceil();
  return qty3((units.isZero() ? dec(1) : units).times(factor));
}

/** The largest quantity a receipt may still take on a line (D-325 `overReceiptPct`). */
export function receivableUpTo(
  ordered: MoneyValue,
  received: MoneyValue,
  overReceiptPct: MoneyValue,
): MoneyValue {
  return qty3(ordered.times(dec(100).plus(overReceiptPct)).div(100).minus(received));
}

// ------------------------------------------------------------------------- E1.1 supplier prices

/** Price per base unit of a price per purchase unit (`factor` base units each), 6 decimals (D-334). */
export function basePrice(unitPrice: MoneyValue, factor: MoneyValue): MoneyValue {
  return cost6(unitPrice.div(factor));
}

/** The change from `previous` to `latest`, in % with 2 decimals; null without a previous price. */
export function changePct(latest: MoneyValue, previous: MoneyValue | null): MoneyValue | null {
  if (!previous || previous.isZero()) return null;
  return latest.minus(previous).times(100).div(previous).toDecimalPlaces(2);
}

export interface PricePoint {
  baseUnitPrice: MoneyValue;
  quantity: MoneyValue | null;
}

/**
 * Lowest, highest and quantity-weighted average price per base unit over a set of purchases (D-334); an
 * unweighted mean when no purchase carries a quantity. Null for no purchases.
 */
export function priceSpread(
  points: PricePoint[],
): { min: MoneyValue; max: MoneyValue; avg: MoneyValue } | null {
  if (points.length === 0) return null;
  let min = points[0]!.baseUnitPrice;
  let max = min;
  let weighted = dec(0);
  let weight = dec(0);
  let sum = dec(0);
  for (const p of points) {
    if (p.baseUnitPrice.lt(min)) min = p.baseUnitPrice;
    if (p.baseUnitPrice.gt(max)) max = p.baseUnitPrice;
    sum = sum.plus(p.baseUnitPrice);
    if (p.quantity && p.quantity.gt(0)) {
      weighted = weighted.plus(p.baseUnitPrice.times(p.quantity));
      weight = weight.plus(p.quantity);
    }
  }
  const avg = weight.gt(0) ? weighted.div(weight) : sum.div(points.length);
  return { min, max, avg: cost6(avg) };
}

/** Rounds a base quantity up to whole purchase units and to the supplier's minimum order (D-335). */
export function roundToPurchase(
  baseQty: MoneyValue,
  factor: MoneyValue,
  minOrderQty: MoneyValue | null,
): { purchaseQty: MoneyValue; baseQty: MoneyValue } {
  let units = baseQty.div(factor).ceil();
  if (units.isZero()) units = dec(1);
  if (minOrderQty && units.lt(minOrderQty)) units = minOrderQty.ceil();
  return { purchaseQty: qty3(units), baseQty: qty3(units.times(factor)) };
}

// ---------------------------------------------------------------------- E2 supplier invoices (AP)

export type LineVariance = 'price' | 'quantity' | 'price_quantity' | 'unordered' | null;

/**
 * 3-way match of one invoice line (D-337): the invoiced quantity (with what earlier invoices took) may not
 * pass what was received, and the price may not differ from the order's net price by more than the tolerance.
 */
export function matchLine(input: {
  invoicedQty: MoneyValue;
  previouslyInvoiced: MoneyValue;
  receivedQty: MoneyValue | null;
  unitPrice: MoneyValue;
  orderedPrice: MoneyValue | null;
  tolerancePct: MoneyValue;
}): LineVariance {
  if (input.receivedQty === null || input.orderedPrice === null) return 'unordered';
  const qtyOff = input.previouslyInvoiced.plus(input.invoicedQty).gt(input.receivedQty);
  const allowed = input.orderedPrice.times(input.tolerancePct).div(100);
  const priceOff = input.unitPrice.minus(input.orderedPrice).abs().gt(allowed);
  if (qtyOff && priceOff) return 'price_quantity';
  if (qtyOff) return 'quantity';
  if (priceOff) return 'price';
  return null;
}

/** Withholding tax on the amount before VAT (D-337), in money. */
export function withholding(subtotal: MoneyValue, ratePct: MoneyValue): MoneyValue {
  return money2(subtotal.times(ratePct).div(100));
}

export const AGING_BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'over90'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** The aging bucket of an amount due on `dueDate` as of `asOf` (both `YYYY-MM-DD`). */
export function agingBucket(dueDate: string, asOf: string): AgingBucket {
  const days = Math.round(
    (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000,
  );
  if (days <= 0) return 'current';
  if (days <= 30) return 'd1_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'over90';
}

// ----------------------------------------------------------------------------- E2 production

/**
 * A material's requirement for an order (D-339): per-batch quantity scaled to the order and grossed up for
 * scrap — `quantity × orderQty / batchQty × 100 / (100 − scrap%)` — rounded up to 3 decimals.
 */
export function materialRequirement(
  perBatch: MoneyValue,
  batchQty: MoneyValue,
  orderQty: MoneyValue,
  scrapPct: MoneyValue,
): MoneyValue {
  const net = perBatch.times(orderQty).div(batchQty);
  const gross = net.times(100).div(dec(100).minus(scrapPct));
  return gross.toDecimalPlaces(3, MoneyDecimal.ROUND_UP);
}

/** Minutes an operation takes for `orderQty`: setup plus run time at the rate per hour, rounded up. */
export function operationMinutes(
  setupMinutes: number,
  runRatePerHour: MoneyValue | null,
  orderQty: MoneyValue,
): number {
  if (!runRatePerHour || !runRatePerHour.gt(0)) return setupMinutes;
  return setupMinutes + orderQty.times(60).div(runRatePerHour).ceil().toNumber();
}

/** Unit cost of finished goods (D-341): the value of the materials consumed over the good quantity. */
export function finishedUnitCost(materialValue: MoneyValue, goodQty: MoneyValue): MoneyValue {
  if (!goodQty.gt(0)) return dec(0);
  return cost6(materialValue.div(goodQty));
}
