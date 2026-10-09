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
