import { isValidThaiTaxId } from './thai-tax-id';

describe('isValidThaiTaxId', () => {
  it.each(['0000000000019', '0000000000027', '0000000001236'])('accepts %s', (id) => {
    expect(isValidThaiTaxId(id)).toBe(true);
  });

  it.each(['0000000000010', '000000000001', '00000000000190', 'A000000000019', '0000000001235'])(
    'refuses %s',
    (id) => {
      expect(isValidThaiTaxId(id)).toBe(false);
    },
  );
});
