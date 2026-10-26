import { computeVat } from '@common/money/vat';

import { rfqLineAmounts, shippingVat } from './rfq-quote-amounts';

/** B-API-6: RFQ quotation lines take their VAT from the shared helper (GLOBAL-RULES §5). Fake amounts. */
describe('rfqLineAmounts (B-API-6)', () => {
  it('prices goods (ex-VAT unit × quantity) and ex-VAT shipping, VAT = rate % of the summed nets, half-up', () => {
    const a = rfqLineAmounts('4.123456', 1000, '120.00', '7');
    // goods 4,123.456 → 4,123.46; + 120.00 = 4,243.46; VAT 297.0422 → 297.04
    expect(a.netAmount.toFixed(2)).toBe('4243.46');
    expect(a.vatAmount.toFixed(2)).toBe('297.04');
    expect(a.grossAmount.toFixed(2)).toBe('4540.50');
  });

  it('agrees with computeVat for the same lines', () => {
    const a = rfqLineAmounts('333.333333', 3, '0', '7');
    const ref = computeVat(
      [
        { amount: '999.999999', inclusive: false },
        { amount: '0', inclusive: false },
      ],
      '7',
    );
    expect(a.vatAmount.toFixed(2)).toBe(ref.vat.toFixed(2));
    expect(a.netAmount.toFixed(2)).toBe('1000.00');
    expect(a.vatAmount.toFixed(2)).toBe('70.00');
  });

  it('rounds VAT half-up (x.xx5 → up)', () => {
    // net 107.50 × 7 % = 7.525 → 7.53
    expect(rfqLineAmounts('107.50', 1, '0', '7').vatAmount.toFixed(2)).toBe('7.53');
  });

  it('uses the rate it is given (the vat_standard version in force), not a constant', () => {
    expect(rfqLineAmounts('100', 10, '0', '10').vatAmount.toFixed(2)).toBe('100.00');
  });

  it('gives the VAT of the shipping line on its own', () => {
    expect(shippingVat('120.00', '7').toFixed(2)).toBe('8.40');
    expect(shippingVat('0', '7').toFixed(2)).toBe('0.00');
  });
});
