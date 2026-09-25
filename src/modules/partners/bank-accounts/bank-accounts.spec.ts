import { maskPhone } from './bank-accounts.service';

describe('maskPhone (verification-call log, §8 / PDPA)', () => {
  it('keeps the prefix and the last four digits only', () => {
    expect(maskPhone('081-000-1234')).toBe('08x-xxx-1234');
    expect(maskPhone('+66 81 000 1234')).toBe('66x-xxx-1234');
    expect(maskPhone('123')).toBe('xxxx');
  });
});
