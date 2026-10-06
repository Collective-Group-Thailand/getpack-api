import { maskPhone, toE164 } from './phone';

describe('phone numbers', () => {
  it.each([
    ['081-000-1234', '+66810001234'],
    ['0810001234', '+66810001234'],
    ['66810001234', '+66810001234'],
    ['+66 81 000 1234', '+66810001234'],
    ['021234567', '+6621234567'],
    ['+14155550100', '+14155550100'],
    ['800000101', '+66800000101'],
    ['81 234 5678', '+66812345678'],
  ])('normalises %s to E.164', (input, expected) => {
    expect(toE164(input)).toBe(expected);
  });

  it.each(['', 'abc', '12', '+0123456789', '08100012345678901'])('rejects %s', (input) => {
    expect(toE164(input)).toBeNull();
  });

  it('masks all but the country code and last four digits', () => {
    expect(maskPhone('+66810001234')).toBe('+66•••••1234');
  });
});
