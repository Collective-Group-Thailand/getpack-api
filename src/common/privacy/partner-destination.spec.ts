import { codeAmong, destinationCode, postcodePrefix } from './partner-destination';

describe('partner destination helpers (P4-D1)', () => {
  it('codes destinations D1, D2 … by position', () => {
    expect(destinationCode(0)).toBe('D1');
    expect(destinationCode(9)).toBe('D10');
    expect(destinationCode(-1)).toBe('D?');
    expect(codeAmong([{ id: 7n }, { id: 3n }], 3n)).toBe('D2');
    expect(codeAmong([{ id: 7n }], 4n)).toBe('D?');
  });

  it('keeps only the first three digits of the postcode', () => {
    expect(postcodePrefix('10110')).toBe('101');
    expect(postcodePrefix(' 50200 ')).toBe('502');
  });
});
