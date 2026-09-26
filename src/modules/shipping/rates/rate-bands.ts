import { MoneyDecimal, type MoneyValue } from '@common/money/money';

/**
 * Band maths shared by the customer rate card and the factory payout cards (D-013, schema-design §3.5).
 * Pure: no database access. Weight `[min, max)` and volume `[min, max)` bands are half-open, a null
 * upper bound is open and a band without volume bounds matches any volume (including an unknown one).
 * A band with volume bounds needs a known volume. A postcode row overrides its zone's rows.
 */
export interface RateBand {
  id: bigint;
  zoneId: bigint;
  postcode: string | null;
  weightMinG: number;
  weightMaxG: number | null;
  volumeMinCm3: bigint | null;
  volumeMaxCm3: bigint | null;
  /** VAT-exclusive amount of the band (customer price or factory payout). */
  amount: MoneyValue;
  /** Charged per started kilogram above `weightMinG`. */
  perExtraKg: MoneyValue | null;
}

export interface Parcel {
  weightG: number;
  /** Null when the packing helper cannot size the shipment. */
  volumeCm3: number | null;
}

function inBand(value: number, min: number | bigint | null, max: number | bigint | null): boolean {
  return (min === null || value >= Number(min)) && (max === null || value < Number(max));
}

export function bandMatches(band: RateBand, parcel: Parcel): boolean {
  if (!inBand(parcel.weightG, band.weightMinG, band.weightMaxG)) return false;
  if (band.volumeMinCm3 === null && band.volumeMaxCm3 === null) return true;
  return parcel.volumeCm3 !== null && inBand(parcel.volumeCm3, band.volumeMinCm3 ?? 0, band.volumeMaxCm3);
}

/**
 * The band that prices `parcel` in `zoneId` for `postcode`: postcode rows first, then zone rows.
 * The exclusion constraints make the match unique within each group; should two ever match (a
 * version drafted before the constraint), the lowest id wins so the result stays deterministic.
 */
export function matchBand<B extends RateBand>(
  bands: readonly B[],
  zoneId: bigint,
  postcode: string,
  parcel: Parcel,
): B | null {
  const pick = (rows: B[]) =>
    rows.filter((b) => bandMatches(b, parcel)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0] ??
    null;
  const inZone = bands.filter((b) => b.zoneId === zoneId);
  return (
    pick(inZone.filter((b) => b.postcode === postcode)) ?? pick(inZone.filter((b) => b.postcode === null))
  );
}

/** Band amount plus `per_extra_kg` × started kilograms above the band minimum, rounded to the satang. */
export function bandAmount(band: RateBand, weightG: number): MoneyValue {
  const extraKg = Math.ceil(Math.max(0, weightG - band.weightMinG) / 1000);
  const extra = band.perExtraKg ? band.perExtraKg.mul(extraKg) : new MoneyDecimal(0);
  return band.amount.add(extra).toDecimalPlaces(2);
}
