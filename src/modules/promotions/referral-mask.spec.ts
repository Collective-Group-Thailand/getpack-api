import { maskName } from './referrals.service';

describe('maskName (PDPA)', () => {
  it('keeps the first letter only', () => {
    expect(maskName('Somchai Test')).toBe('S•••');
    expect(maskName('สมชาย ทดสอบ')).toBe('ส•••');
    expect(maskName('  ')).toBe('•••');
    expect(maskName(null)).toBe('•••');
  });
});
