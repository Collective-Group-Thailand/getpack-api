import Decimal from 'decimal.js';
import fc from 'fast-check';

import { deviationPct, percentile, spread } from './stats';

const d = (values: (number | string)[]) => values.map((v) => new Decimal(v));

describe('price statistics (D-040 group 2)', () => {
  it('interpolates between closest ranks like PERCENTILE.INC', () => {
    expect(percentile(d([1, 2, 3, 4]), 0.25).toString()).toBe('1.75');
    expect(percentile(d([1, 2, 3, 4]), 0.5).toString()).toBe('2.5');
    expect(percentile(d([4, 1, 3, 2]), 0.75).toString()).toBe('3.25');
    expect(percentile(d(['12.5']), 0.75).toString()).toBe('12.5');
    expect(spread(d([10, 12, 14])).median.toString()).toBe('12');
  });

  it('keeps percentiles ordered and within the range, whatever the input', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 10_000_000 }), { minLength: 1, maxLength: 50 }),
        (raw) => {
          const values = raw.map((v) => new Decimal(v).dividedBy(1000));
          const { p25, median, p75 } = spread(values);
          const min = Decimal.min(...values);
          const max = Decimal.max(...values);
          return p25.gte(min) && p25.lte(median) && median.lte(p75) && p75.lte(max);
        },
      ),
    );
  });

  it('computes the deviation from the suggestion in percent', () => {
    expect(deviationPct(new Decimal('11'), new Decimal('10'))?.toString()).toBe('10');
    expect(deviationPct(new Decimal('9'), new Decimal('12'))?.toString()).toBe('-25');
    expect(deviationPct(new Decimal('9'), new Decimal('0'))).toBeNull();
  });
});
