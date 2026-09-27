import { MoneyDecimal } from '@common/money/money';
import fc from 'fast-check';

import { earnPoints, pointsAfterRefund, pointsForBaht, redeemablePoints, tierFor,type TierRule } from './points-math';

const TIERS: TierRule[] = [
  { tier: 'member', minSpend12m: '0.00', multiplier: '1' },
  { tier: 'silver', minSpend12m: '50000.00', multiplier: '1.25' },
  { tier: 'gold', minSpend12m: '200000.00', multiplier: '1.5' },
];

describe('points maths (D-130…D-134)', () => {
  it('earns 1 point per THB 500 before VAT × the tier multiplier, rounded down', () => {
    expect(earnPoints('12504.21', '500.00', '1')).toBe(25);
    expect(earnPoints('12504.21', '500.00', '1.25')).toBe(31);
    expect(earnPoints('12504.21', '500.00', '1.5')).toBe(37);
    expect(earnPoints('499.99', '500.00', '1.5')).toBe(0);
    expect(earnPoints('900.00', '500.00', '1.25')).toBe(1);
  });

  it('converts baht rewards at THB 2.50 per point, rounded down (D-131 table)', () => {
    expect(pointsForBaht('50.00', '2.50')).toBe(20);
    expect(pointsForBaht('20.00', '2.50')).toBe(8);
    expect(pointsForBaht('10.00', '2.50')).toBe(4);
    expect(pointsForBaht('500.00', '2.50')).toBe(200);
    expect(pointsForBaht('11.00', '2.50')).toBe(4);
  });

  it('picks the tier of the 12-month spend', () => {
    expect(tierFor('0.00', TIERS).tier).toBe('member');
    expect(tierFor('49999.99', TIERS).tier).toBe('member');
    expect(tierFor('50000.00', TIERS).tier).toBe('silver');
    expect(tierFor('250000.00', TIERS).tier).toBe('gold');
  });

  it('takes back at least the refunded share of an earning', () => {
    expect(pointsAfterRefund(25, '12504.21', '0.00')).toBe(25);
    expect(pointsAfterRefund(25, '12504.21', '6252.11')).toBe(12);
    expect(pointsAfterRefund(25, '12504.21', '99999.00')).toBe(0);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000 }), fc.integer({ min: 1, max: 10_000_000 }), fc.integer({ min: 0, max: 100 }), (earned, cents, pct) => {
        const base = (cents / 100).toFixed(2);
        const refunded = ((cents * pct) / 10_000).toFixed(2);
        const left = pointsAfterRefund(earned, base, refunded);
        expect(left).toBeGreaterThanOrEqual(0);
        expect(left).toBeLessThanOrEqual(earned);
        // Never more than the proportional share of what is left: left × base ≤ earned × (base − refunded).
        expect(new MoneyDecimal(left).mul(base).lte(new MoneyDecimal(earned).mul(new MoneyDecimal(base).sub(refunded)))).toBe(true);
      }),
    );
  });

  it('caps a redemption at 20 % of the order, the margin room and the balance; refuses below THB 10', () => {
    const base = { balance: 1000, pointValue: '2.50', orderValue: '1000.00', maxPctOfOrder: '20', minimumBaht: '10.00', marginRoom: '10000.00' };
    expect(redeemablePoints({ ...base, requested: 40 })).toEqual({ points: 40, reason: 'ok' });
    expect(redeemablePoints({ ...base, requested: 500 })).toEqual({ points: 80, reason: 'capped_pct' });
    expect(redeemablePoints({ ...base, requested: 500, marginRoom: '50.00' })).toEqual({ points: 20, reason: 'capped_margin' });
    expect(redeemablePoints({ ...base, requested: 500, balance: 30 })).toEqual({ points: 30, reason: 'capped_balance' });
    expect(redeemablePoints({ ...base, requested: 3 })).toEqual({ points: 0, reason: 'below_minimum' });
    expect(redeemablePoints({ ...base, requested: 500, marginRoom: '5.00' })).toEqual({ points: 0, reason: 'below_minimum' });
  });
});
