import { MoneyDecimal } from '@common/money/money';

import { type QuoteStepView, type QuoteView } from './quote-engine.service';

/** C4-API-2: the store-only fields of each quantity tier, derived from the engine's own figures (no new maths). */
export interface StoreStepFields {
  savingPercent: number | null;
  vatRate: string | null;
  zoneName: { th: string; en: string } | null;
  arrival: { from: string; to: string } | null;
}

const priced = (s: QuoteStepView): boolean => s.instant && s.unitPrice !== null;

/**
 * Per tier: (1 − unitPrice / unitPrice of the smallest priced tier) × 100, rounded half-up to a whole number.
 * Null for the smallest priced tier itself, a tier without an instant price, and a result ≤ 0.
 */
export function savingPercents(steps: readonly QuoteStepView[]): (number | null)[] {
  const base = steps
    .filter(priced)
    .reduce<QuoteStepView | null>((min, s) => (min === null || s.quantity < min.quantity ? s : min), null);
  const baseUnit = base ? new MoneyDecimal(base.unitPrice!) : null;
  return steps.map((s) => {
    if (!base || !baseUnit || s === base || !priced(s) || baseUnit.lte(0)) return null;
    const pct = new MoneyDecimal(1)
      .sub(new MoneyDecimal(s.unitPrice!).div(baseUnit))
      .mul(100)
      .toDecimalPlaces(0, MoneyDecimal.ROUND_HALF_UP);
    return pct.gt(0) ? pct.toNumber() : null;
  });
}

/** The VAT rate in force as a fraction decimal string ("7" % → "0.07"); null when unknown. */
export const vatRateOf = (ratePct: string | null | undefined): string | null =>
  ratePct === null || ratePct === undefined ? null : new MoneyDecimal(ratePct).div(100).toString();

/**
 * The store fields of every tier: `vatRate` beside each `vatAmount`, the destination zone's name and the arrival
 * window where shipping is priced. Arrival is the engine's `earliestDeliveryDate` (ship date plus the zone's extra
 * lead days or the carrier's transit days, in working days of the business calendar with its holidays); no maximum
 * transit is recorded, so `to` equals `from`. Never an origin or factory location (GLOBAL-RULES §1).
 */
export function storeStepFields(
  view: Pick<QuoteView, 'steps' | 'vatRatePct' | 'shippingZone'>,
): StoreStepFields[] {
  const savings = savingPercents(view.steps);
  const vatRate = vatRateOf(view.vatRatePct);
  return view.steps.map((s, i) => ({
    savingPercent: savings[i]!,
    vatRate: s.vatAmount !== null ? vatRate : null,
    zoneName: s.shippingAmount !== null ? (view.shippingZone ?? null) : null,
    arrival: s.earliestDeliveryDate ? { from: s.earliestDeliveryDate, to: s.earliestDeliveryDate } : null,
  }));
}
