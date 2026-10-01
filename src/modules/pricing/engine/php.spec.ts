import fc from 'fast-check';

import {
  convertNumberFloat,
  convertTo2Decimal,
  convertTo2Decimal3Digit,
  numberFormat,
  phpFloatval,
  phpIntval,
  phpRound,
  roundUp,
} from './php';

describe('PHP 7 numerics for the ported calculators (B2.3)', () => {
  it('rounds like PHP round(), including the pre-rounding step', () => {
    // php.net/manual/en/function.round.php examples
    expect(phpRound(3.4)).toBe(3);
    expect(phpRound(3.5)).toBe(4);
    expect(phpRound(3.6, 0)).toBe(4);
    expect(phpRound(1.95583, 2)).toBe(1.96);
    expect(phpRound(1241757, -3)).toBe(1242000);
    expect(phpRound(5.045, 2)).toBe(5.05);
    expect(phpRound(5.055, 2)).toBe(5.06);
    expect(phpRound(345, -2)).toBe(300);
    expect(phpRound(345, -3)).toBe(0);
    expect(phpRound(678, -2)).toBe(700);
    expect(phpRound(678, -3)).toBe(1000);
    // Where a naive Math.round(x * 100) / 100 differs from PHP
    expect(Math.round(1.005 * 100) / 100).toBe(1);
    expect(phpRound(1.005, 2)).toBe(1.01);
    expect(Math.round(5.015 * 100) / 100).toBe(5.01);
    expect(phpRound(5.015, 2)).toBe(5.02);
    expect(Math.round(0.285 * 100) / 100).toBe(0.28);
    expect(phpRound(0.285, 2)).toBe(0.29);
    expect(phpRound(1.955, 2)).toBe(1.96);
    // Half away from zero for negatives
    expect(phpRound(-3.5)).toBe(-4);
    expect(phpRound(-1.005, 2)).toBe(-1.01);
    expect(phpRound(0)).toBe(0);
  });

  it('keeps round() idempotent and within half a unit of the last place', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e9, max: 1e9, noNaN: true }), (x) => {
        const r = phpRound(x, 2);
        return Math.abs(r - x) <= 0.005 + 1e-9 * Math.max(1, Math.abs(x)) && phpRound(r, 2) === r;
      }),
    );
  });

  it('formats like PHP number_format()', () => {
    // php.net/manual/en/function.number-format.php examples
    expect(numberFormat(1234.56)).toBe('1,235');
    expect(numberFormat(1234.56, 2, ',', ' ')).toBe('1 234,56');
    expect(numberFormat(1234.5678, 2, '.', '')).toBe('1234.57');
    expect(numberFormat(1.005, 2)).toBe('1.01');
    expect(numberFormat(-0.001, 2)).toBe('0.00');
    expect(numberFormat(-1234567.891, 2)).toBe('-1,234,567.89');
  });

  it('coerces numeric strings like PHP floatval() / intval()', () => {
    expect(phpFloatval('1,234.50')).toBe(1);
    expect(phpFloatval(' 12.5abc')).toBe(12.5);
    expect(phpFloatval('abc')).toBe(0);
    expect(phpFloatval('.5')).toBe(0.5);
    expect(phpFloatval('1e3')).toBe(1000);
    expect(phpFloatval(null)).toBe(0);
    expect(phpIntval('12abc')).toBe(12);
    expect(phpIntval('-7.9')).toBe(-7);
    expect(phpIntval('1e3')).toBe(1000);
  });

  it('ports convertTo2Decimal / convertTo2Decimal3Digit (helpers.php:1691-1703)', () => {
    expect(convertTo2Decimal(1.234)).toBe(1.24);
    expect(convertTo2Decimal(1.2)).toBe(1.2);
    // 1.1 * 100 = 110.00000000000001 in binary floating point, so legacy ceils to 1.11.
    expect(convertTo2Decimal(1.1)).toBe(1.11);
    expect(convertTo2Decimal3Digit(1.2341)).toBe(1.24);
    expect(convertTo2Decimal3Digit(1.2301)).toBe(1.23);
  });

  it('ports roundUp (helpers.php:1706-1711): ceiling to the digit, then round', () => {
    // The pouch factory price: 8.93 × 1.15 = 10.2695 → 10.3 (port map golden G1).
    expect(roundUp(8.93 * 1.15, 1)).toBe(10.3);
    expect(roundUp(10.3, 1)).toBe(10.3);
    expect(roundUp(10.31, 1)).toBe(10.4);
    // A digit of 0 or null falls back to the decimals, as PHP's `$digit == null`.
    expect(roundUp(1.231, 2, 0)).toBe(1.24);
    expect(roundUp(1.2341, 2, 3)).toBe(1.24);
  });

  it('ports convertNumberFloat (helpers.php:2686-2706) as a plain 2-decimal string', () => {
    expect(convertNumberFloat(1234.567)).toBe('1234.57');
    expect(convertNumberFloat('1,234.5')).toBe('1234.50');
    expect(convertNumberFloat(null)).toBe('0.00');
    expect(convertNumberFloat(2.5, 0)).toBe('3');
    expect(convertNumberFloat(1.2345, 3)).toBe('1.24');
  });
});
