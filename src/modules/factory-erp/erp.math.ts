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

// ------------------------------------------------------------------------ E2.1 sourcing (D-346 – D-350)

/** D-346: the price for `qty` (supplier's unit) — the break with the largest minimum not above it. */
export function breakPrice(
  breaks: { minQty: MoneyValue; unitPrice: MoneyValue }[],
  qty: MoneyValue,
): MoneyValue | null {
  let best: { minQty: MoneyValue; unitPrice: MoneyValue } | null = null;
  for (const b of breaks) if (b.minQty.lte(qty) && (!best || b.minQty.gt(best.minQty))) best = b;
  return best ? best.unitPrice : null;
}

/** D-347: is `now` (per base unit) more than `alertPct` % above `before`? Returns the change % when it is. */
export function priceRise(
  now: MoneyValue,
  before: MoneyValue | null,
  alertPct: MoneyValue,
): MoneyValue | null {
  if (!before || !before.gt(0)) return null;
  const change = now.minus(before).times(100).div(before);
  return change.gt(alertPct) ? change.toDecimalPlaces(2) : null;
}

/**
 * D-350: splits `total` (money) over `weights` in proportion, in satang, the remainder going to the largest
 * fractions (ties: earlier lines). All-zero weights split evenly.
 */
export function allocate(total: MoneyValue, weights: MoneyValue[]): MoneyValue[] {
  if (weights.length === 0) return [];
  const cents = total.times(100).toDecimalPlaces(0);
  const sum = weights.reduce((a, w) => a.plus(w), dec(0));
  const w = sum.gt(0) ? weights : weights.map(() => dec(1));
  const s = sum.gt(0) ? sum : dec(weights.length);
  const exact = w.map((x) => cents.times(x).div(s));
  const floors = exact.map((x) => x.floor());
  let left = cents.minus(floors.reduce((a, x) => a.plus(x), dec(0))).toNumber();
  const order = exact
    .map((x, i) => ({ i, frac: x.minus(floors[i]!) }))
    .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);
  const out = [...floors];
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] = out[i]!.plus(1);
    left -= 1;
  }
  return out.map((c) => c.div(100));
}

/**
 * D-350: the part of a later charge on a receipt line that can still go into stock value — in proportion to
 * how much of the line's base quantity is still on hand (at most all of it).
 */
export function absorbable(amount: MoneyValue, onHand: MoneyValue, receivedBase: MoneyValue): MoneyValue {
  if (!onHand.gt(0) || !receivedBase.gt(0)) return dec(0);
  if (onHand.gte(receivedBase)) return amount;
  return money2(amount.times(onHand).div(receivedBase));
}

export type SupplierGrade = 'A' | 'B' | 'C' | 'D';

/**
 * D-349: a supplier's score over 12 months — 60 % quality (accepted ÷ delivered value) + 40 % on time — and
 * its grade; null below 3 receipts.
 */
export function supplierScore(input: {
  receipts: number;
  deliveredValue: MoneyValue;
  acceptedValue: MoneyValue;
  onTime: number;
  timed: number;
}): {
  qualityPct: MoneyValue | null;
  onTimePct: MoneyValue | null;
  score: MoneyValue | null;
  grade: SupplierGrade | null;
} {
  const qualityPct = input.deliveredValue.gt(0)
    ? input.acceptedValue.times(100).div(input.deliveredValue).toDecimalPlaces(2)
    : null;
  const onTimePct = input.timed > 0 ? dec(input.onTime).times(100).div(input.timed).toDecimalPlaces(2) : null;
  if (input.receipts < 3 || qualityPct === null) return { qualityPct, onTimePct, score: null, grade: null };
  const score = qualityPct
    .times(60)
    .plus((onTimePct ?? qualityPct).times(40))
    .div(100)
    .toDecimalPlaces(2);
  const grade: SupplierGrade = score.gte(95) ? 'A' : score.gte(85) ? 'B' : score.gte(70) ? 'C' : 'D';
  return { qualityPct, onTimePct, score, grade };
}

// ----------------------------------------------------------------------------- E3 maintenance (D-355)

/**
 * D-355: how far a preventive plan is from due — days left (from the last done, else the plan's start) and
 * impressions left — and whether an order should be opened now (3 days or 10 % of impressions left).
 */
export function maintenanceDue(input: {
  everyDays: number | null;
  everyImpressions: number | null;
  daysSince: number;
  impressionsSince: number;
}): { daysLeft: number | null; impressionsLeft: number | null; due: boolean } {
  const daysLeft = input.everyDays === null ? null : input.everyDays - input.daysSince;
  const impressionsLeft =
    input.everyImpressions === null ? null : input.everyImpressions - input.impressionsSince;
  const due =
    (daysLeft !== null && daysLeft <= 3) ||
    (impressionsLeft !== null &&
      input.everyImpressions !== null &&
      impressionsLeft <= input.everyImpressions * 0.1);
  return { daysLeft, impressionsLeft, due };
}
