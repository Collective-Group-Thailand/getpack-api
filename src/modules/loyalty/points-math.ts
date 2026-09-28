import { MoneyDecimal, type MoneyValue } from '@common/money/money';

/**
 * Loyalty arithmetic (D-130…D-134), pure. Points are whole numbers and always rounded **down** — a
 * customer never receives a fraction the rules do not give.
 */

const D = (v: MoneyValue | string | number) => new MoneyDecimal(v.toString());

export interface TierRule {
  tier: 'member' | 'silver' | 'gold';
  minSpend12m: string;
  multiplier: string;
}

/** Points for an order (D-130, D-134): ⌊ ⌊base ÷ baht per point⌋ × tier multiplier ⌋. */
export function earnPoints(base: MoneyValue | string, bahtPerPoint: string, multiplier: string): number {
  if (D(base).lte(0)) return 0;
  const units = D(base).div(bahtPerPoint).floor();
  return units.mul(multiplier).floor().toNumber();
}

/** Baht-defined rewards convert at the point value, rounded down (D-131: THB 50 → 20 points). */
export function pointsForBaht(baht: string, pointValue: string): number {
  return D(baht).div(pointValue).floor().toNumber();
}

/** The tier a 12-month spend reaches (highest threshold met). */
export function tierFor(spend12m: MoneyValue | string, rules: readonly TierRule[]): TierRule {
  const sorted = [...rules].sort((a, b) => D(b.minSpend12m).cmp(D(a.minSpend12m)));
  return sorted.find((r) => D(spend12m).gte(r.minSpend12m)) ?? sorted[sorted.length - 1]!;
}

/**
 * Points still due on an earning after refunds (D-132): the earning scaled by what is left of its base,
 * rounded down, so a refund always takes back at least its proportional share.
 */
export function pointsAfterRefund(
  earned: number,
  base: MoneyValue | string,
  refundedBase: MoneyValue | string,
): number {
  if (earned <= 0 || D(base).lte(0)) return 0;
  const left = MoneyDecimal.max(D(base).sub(refundedBase), D(0));
  return Math.min(earned, D(earned).mul(left).div(base).floor().toNumber());
}

/**
 * The most points an order group may redeem (D-133): at most `maxPctOfOrder` % of the order value, at
 * most the discount room the margin floor leaves, never more than the balance. Returns 0 when the
 * result is below the minimum redemption.
 */
export function redeemablePoints(opts: {
  requested: number;
  balance: number;
  pointValue: string;
  orderValue: MoneyValue | string;
  maxPctOfOrder: string;
  minimumBaht: string;
  marginRoom: MoneyValue | string;
}): { points: number; reason: 'ok' | 'below_minimum' | 'capped_pct' | 'capped_margin' | 'capped_balance' } {
  const byPct = D(opts.orderValue).mul(opts.maxPctOfOrder).div(100);
  const caps: [number, 'capped_pct' | 'capped_margin' | 'capped_balance'][] = [
    [D(byPct).div(opts.pointValue).floor().toNumber(), 'capped_pct'],
    [MoneyDecimal.max(D(opts.marginRoom), D(0)).div(opts.pointValue).floor().toNumber(), 'capped_margin'],
    [opts.balance, 'capped_balance'],
  ];
  let points = opts.requested;
  let reason: 'ok' | 'below_minimum' | 'capped_pct' | 'capped_margin' | 'capped_balance' = 'ok';
  for (const [cap, why] of caps) {
    if (cap < points) {
      points = cap;
      reason = why;
    }
  }
  if (points <= 0 || D(points).mul(opts.pointValue).lt(opts.minimumBaht))
    return { points: 0, reason: 'below_minimum' };
  return { points, reason };
}
