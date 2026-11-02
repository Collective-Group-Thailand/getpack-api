import { isThaiTaxId } from './agent-payout-profiles.service';
import { sameName } from './agents.service';

describe('payout profile rules (D-466)', () => {
  it('checks the Thai tax id check digit', () => {
    expect(isThaiTaxId('1101700203450')).toBe(true);
    expect(isThaiTaxId('0105536000011')).toBe(true);
    expect(isThaiTaxId('0000000000124')).toBe(true);
    expect(isThaiTaxId('0000000000127')).toBe(false);
    expect(isThaiTaxId('0105536000013')).toBe(false);
    expect(isThaiTaxId('1101700203452')).toBe(false);
    expect(isThaiTaxId('110170020345')).toBe(false);
    expect(isThaiTaxId('11017002034a1')).toBe(false);
  });

  it('matches the bank account name to the legal name, ignoring titles, spaces and case', () => {
    expect(sameName('นาย สมชาย  ขายเก่ง', 'สมชาย ขายเก่ง')).toBe(true);
    expect(sameName('Mr. Somchai Khaikeng', 'somchai khaikeng')).toBe(true);
    expect(sameName('บริษัท ขายดี จำกัด', 'บริษัทขายดีจำกัด')).toBe(true);
    expect(sameName('สมหญิง ขายเก่ง', 'สมชาย ขายเก่ง')).toBe(false);
  });
});
