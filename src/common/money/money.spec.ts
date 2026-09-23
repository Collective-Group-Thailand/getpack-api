import { formatMoney, parseDecimal, parseMoney } from './money';

describe('money', () => {
  it('parses numeric(14,2) strings and rejects anything else', () => {
    expect(parseMoney('1234.50').toFixed(2)).toBe('1234.50');
    expect(parseMoney('-5').toFixed(2)).toBe('-5.00');
    for (const bad of ['1.005', '1e3', '', '12,000.00', '1234567890123.00', ' 1.00']) {
      expect(() => parseMoney(bad)).toThrow(RangeError);
    }
  });

  it('formats with exactly two decimals, half-up by default', () => {
    expect(formatMoney('0.005')).toBe('0.01');
    expect(formatMoney('2.675')).toBe('2.68');
    expect(formatMoney('-2.675')).toBe('-2.68');
    expect(formatMoney(10)).toBe('10.00');
  });

  it('keeps decimal arithmetic exact (no binary floating point)', () => {
    expect(formatMoney(parseMoney('0.10').plus(parseMoney('0.20')))).toBe('0.30');
    expect(parseDecimal('12.5').times(parseMoney('20000.00')).div(100).toFixed(2)).toBe('2500.00');
  });

  it('property: formatting is idempotent and never loses more than half a satang', () => {
    for (let i = 0; i < 500; i++) {
      const raw = (Math.random() * 1e6 - 5e5).toFixed(6);
      const once = formatMoney(raw);
      expect(formatMoney(once)).toBe(once);
      expect(parseDecimal(once).minus(parseDecimal(raw)).abs().lte('0.005')).toBe(true);
    }
  });
});
