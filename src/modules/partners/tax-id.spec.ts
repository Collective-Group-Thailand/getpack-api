import { isValidThaiTaxId } from './tax-id';

describe('isValidThaiTaxId', () => {
  it('accepts numbers whose last digit is the check digit', () => {
    expect(isValidThaiTaxId('0000000000001')).toBe(true);
    expect(isValidThaiTaxId('0000000000019')).toBe(true);
  });

  it('refuses a wrong check digit, other lengths and non-digits', () => {
    expect(isValidThaiTaxId('0000000000018')).toBe(false);
    expect(isValidThaiTaxId('000000000001')).toBe(false);
    expect(isValidThaiTaxId('000000000000A')).toBe(false);
  });
});
