import Decimal from 'decimal.js';

/**
 * Percentile with linear interpolation between closest ranks (the common "type 7" definition, as
 * spreadsheet PERCENTILE.INC). `p` in [0, 1]; `values` must not be empty.
 */
export function percentile(values: Decimal[], p: number): Decimal {
  if (values.length === 0) throw new Error('percentile of an empty set');
  if (p < 0 || p > 1) throw new Error('percentile rank must be within [0, 1]');
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  const rank = new Decimal(p).times(sorted.length - 1);
  const lower = rank.floor().toNumber();
  const upper = rank.ceil().toNumber();
  const weight = rank.minus(lower);
  return sorted[lower]!.plus(sorted[upper]!.minus(sorted[lower]!).times(weight));
}

export interface Spread {
  p25: Decimal;
  median: Decimal;
  p75: Decimal;
}

export const spread = (values: Decimal[]): Spread => ({
  p25: percentile(values, 0.25),
  median: percentile(values, 0.5),
  p75: percentile(values, 0.75),
});

/** (proposed − suggested) ÷ suggested × 100; null when the suggestion is zero. */
export function deviationPct(proposed: Decimal, suggested: Decimal): Decimal | null {
  if (suggested.isZero()) return null;
  return proposed.minus(suggested).dividedBy(suggested).times(100);
}
