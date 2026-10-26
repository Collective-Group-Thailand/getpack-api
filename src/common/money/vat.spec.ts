import { computeVat } from './vat';

describe('computeVat (DECISIONS-STAGE-A §7)', () => {
  it('VAT-inclusive goods ฿5,178.00 → VAT ฿338.75', () => {
    expect(computeVat([{ amount: '5178.00', inclusive: true }], '7').vat.toFixed(2)).toBe('338.75');
  });
  it('VAT-inclusive goods ฿4,710.00 → VAT ฿308.13', () => {
    expect(computeVat([{ amount: '4710.00', inclusive: true }], '7').vat.toFixed(2)).toBe('308.13');
  });
  it('includes the ฿2,000 design fee in VAT', () => {
    const r = computeVat(
      [
        { amount: '4710.00', inclusive: true },
        { amount: '2000.00', inclusive: true },
      ],
      '7',
    );
    // 4401.87 + 1869.16 = 6271.03 → 438.9721 → 438.97
    expect(r.lineNets.map((n) => n.toFixed(2))).toEqual(['4401.87', '1869.16']);
    expect(r.vat.toFixed(2)).toBe('438.97');
  });
  it('adds VAT-exclusive shipping to the taxable sum', () => {
    const r = computeVat(
      [
        { amount: '5178.00', inclusive: true },
        { amount: '150.00', inclusive: false },
      ],
      '7',
    );
    expect(r.net.toFixed(2)).toBe('4989.25');
    expect(r.vat.toFixed(2)).toBe('349.25');
  });
  it('uses the rate it is given', () => {
    expect(computeVat([{ amount: '100.00', inclusive: false }], '10').vat.toFixed(2)).toBe('10.00');
  });
});
