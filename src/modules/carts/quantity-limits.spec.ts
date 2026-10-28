import { quantityLimitError } from './quantity-limits';

describe('quantityLimitError (D-454: the minimum order counts per size)', () => {
  const limits = { quantityMin: 100, quantityMax: 5000 };

  it('accepts a quantity within the limits, at the minimum and at the maximum', () => {
    expect(quantityLimitError(100, limits)).toBeNull();
    expect(quantityLimitError(300, limits)).toBeNull();
    expect(quantityLimitError(5000, limits)).toBeNull();
  });

  it('refuses one size below its own minimum even when the sizes together reach it', () => {
    // Two sizes of the same product: 60 + 60 = 120 ≥ 100, but each item is checked alone.
    const items = [60, 60];
    expect(items.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(limits.quantityMin);
    for (const quantity of items)
      expect(quantityLimitError(quantity, limits)).toEqual({
        path: 'quantity',
        code: 'min',
        message: 'at least 100',
      });
  });

  it('refuses a quantity above the maximum', () => {
    expect(quantityLimitError(5001, limits, 'quoteOptionId')).toEqual({
      path: 'quoteOptionId',
      code: 'max',
      message: 'at most 5000',
    });
  });

  it('accepts anything when the product sets no limit', () => {
    expect(quantityLimitError(1, null)).toBeNull();
    expect(quantityLimitError(1, { quantityMin: null, quantityMax: null })).toBeNull();
  });
});
