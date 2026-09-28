import { assertExpression, evaluate, ExpressionError } from './expression';

describe('posting expressions (ADR-0007)', () => {
  const scope = { a: '10.50', b: '3', nested: { c: '2.25' }, list: [{ v: '1.10' }], none: null };

  it('does decimal arithmetic with precedence and parentheses', () => {
    expect(evaluate('a + b * 2', scope).toFixed(2)).toBe('16.50');
    expect(evaluate('(a + b) * 2', scope).toFixed(2)).toBe('27.00');
    expect(evaluate('a - nested.c - -1', scope).toFixed(2)).toBe('9.25');
    expect(evaluate('list.0.v * 3', scope).toFixed(2)).toBe('3.30');
  });

  it('is exact where binary floats are not', () => {
    expect(evaluate('0.1 + 0.2', {}).toString()).toBe('0.3');
    expect(evaluate('round(1070.005 * 1)', {}).toFixed(2)).toBe('1070.01');
  });

  it('treats missing and null values as zero', () => {
    expect(evaluate('a + missing + none', scope).toFixed(2)).toBe('10.50');
  });

  it('has round, min, max and abs', () => {
    expect(evaluate('round(a / b)', scope).toFixed(2)).toBe('3.50');
    expect(evaluate('min(a, b, 4)', scope).toFixed(0)).toBe('3');
    expect(evaluate('max(a, b)', scope).toFixed(2)).toBe('10.50');
    expect(evaluate('abs(b - a)', scope).toFixed(2)).toBe('7.50');
  });

  it('refuses non-decimals, bad syntax and division by zero', () => {
    expect(() => evaluate('a + text', { a: '1', text: 'abc' })).toThrow(ExpressionError);
    expect(() => evaluate('a +', scope)).toThrow(ExpressionError);
    expect(() => evaluate('a / 0', scope)).toThrow(ExpressionError);
    expect(() => evaluate('a $ b', scope)).toThrow(ExpressionError);
    expect(() => assertExpression('round(a')).toThrow(ExpressionError);
    expect(() => assertExpression('bahtValue * rate / 100')).not.toThrow();
  });
});
