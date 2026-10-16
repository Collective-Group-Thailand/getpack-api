import { gs1CheckDigit, validateBarcode } from './barcodes';

describe('barcodes (D-283)', () => {
  it('computes GS1 check digits', () => {
    expect(gs1CheckDigit('885123456789')).toBe(8); // a fake GS1 Thailand-prefixed number
    expect(gs1CheckDigit('9638507')).toBe(4); // EAN-8 9638 5074
    expect(gs1CheckDigit('03600029145')).toBe(2); // UPC-A 036000291452
  });

  it.each([
    ['ean13', '8851234567898', true, []],
    ['ean13', '8851234567890', false, ['check_digit']],
    ['ean13', '885123456789', true, []],
    ['ean13', '88512345678', false, ['wrong_length']],
    ['ean13', '88512345678X', false, ['digits_only']],
    ['ean8', '96385074', true, []],
    ['upca', '036000291452', true, []],
    ['code128', 'PK-2610-0001', true, []],
    ['code128', 'กล่อง', false, ['not_ascii']],
    ['qr', 'https://getpack.example.invalid/p/1', true, []],
    ['qr', '', false, ['empty']],
  ] as const)('%s %s → valid %s', (symbology, value, valid, problems) => {
    const r = validateBarcode(symbology, value);
    expect(r.valid).toBe(valid);
    expect(r.problems).toEqual(problems);
  });

  it('adds the check digit to 12 EAN-13 digits and gives the GS1 minimum width', () => {
    expect(validateBarcode('ean13', '885123456789')).toMatchObject({
      normalised: '8851234567898',
      minWidthMm: 29.83,
    });
    expect(validateBarcode('qr', 'x'.repeat(1300), 'H').problems).toEqual(['too_long_for_level']);
    expect(validateBarcode('qr', 'x'.repeat(1300), 'L').valid).toBe(true);
  });
});
