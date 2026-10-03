import { targetGap, targetString } from './target-price';

describe('targetGap (D-247)', () => {
  it('measures the unit price against the target in THB and %', () => {
    expect(targetGap('13.38', '11.50')).toEqual({ gapPerUnit: '1.88', gapPct: '16.35', meetsTarget: false });
  });

  it('is negative and met below the target, met exactly at it', () => {
    expect(targetGap('10.00', '12.50')).toEqual({ gapPerUnit: '-2.50', gapPct: '-20.00', meetsTarget: true });
    expect(targetGap('12.50', '12.50')).toEqual({ gapPerUnit: '0.00', gapPct: '0.00', meetsTarget: true });
  });

  it('rounds half up on 6-decimal stored unit prices', () => {
    expect(targetGap('1.234567', '1.00')).toEqual({
      gapPerUnit: '0.23',
      gapPct: '23.46',
      meetsTarget: false,
    });
  });

  it('is null without a target or a price', () => {
    expect(targetGap(null, '1.00')).toBeNull();
    expect(targetGap('1.00', null)).toBeNull();
    expect(targetGap('1.00', undefined)).toBeNull();
  });

  it('formats targets with two decimals', () => {
    expect(targetString('11.5')).toBe('11.50');
    expect(targetString(null)).toBeNull();
  });
});
