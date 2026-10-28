import { MoneyDecimal } from '@common/money/money';

import { exVatFigure, vatStandardPct } from './vat-figures';

/** C1b (DECISIONS-STAGE-A §10.6, D-447): the ex-VAT figure next to every VAT-inclusive catalogue price. */
describe('ex-VAT figures', () => {
  it("takes the shared helper's ex-VAT of an inclusive price, half-up to the satang", () => {
    expect(exVatFigure('107.00', new MoneyDecimal('7'))).toBe('100.00');
    expect(exVatFigure('15.70', new MoneyDecimal('7'))).toBe('14.67');
    expect(exVatFigure('4.28', new MoneyDecimal('7'))).toBe('4.00');
  });

  it('gives nothing without a price or a rate — never a constant rate', () => {
    expect(exVatFigure(null, new MoneyDecimal('7'))).toBeNull();
    expect(exVatFigure('107.00', null)).toBeNull();
  });

  it('reads the approved vat_standard version in force', async () => {
    const findFirst = jest.fn().mockResolvedValue({ ratePct: '7.00' });
    const at = new Date('2026-10-28T00:00:00Z');
    await expect(vatStandardPct({ taxRateVersion: { findFirst } } as never, at)).resolves.toEqual(
      new MoneyDecimal('7'),
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taxRate: { code: 'vat_standard' }, status: 'approved', effectiveFrom: { lte: at } },
      }),
    );
    findFirst.mockResolvedValue(null);
    await expect(vatStandardPct({ taxRateVersion: { findFirst } } as never)).resolves.toBeNull();
  });
});
