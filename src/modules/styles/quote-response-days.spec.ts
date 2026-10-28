import { businessDayHours, quoteResponseDaysOf } from './quote-response-days';

const NINE_TO_SIX = { from: '09:00', to: '18:00', timezone: 'Asia/Bangkok' };

describe('quoteResponseDaysOf (C1c, DECISIONS-STAGE-A §11.2)', () => {
  it('divides the SLA hours by the hours of one business day, rounded up', () => {
    expect(businessDayHours(NINE_TO_SIX)).toBe(9);
    expect(quoteResponseDaysOf(9, NINE_TO_SIX)).toBe(1);
    expect(quoteResponseDaysOf(18, NINE_TO_SIX)).toBe(2);
    expect(quoteResponseDaysOf(24, NINE_TO_SIX)).toBe(3);
    expect(quoteResponseDaysOf(4, NINE_TO_SIX)).toBe(1);
    expect(quoteResponseDaysOf('27', NINE_TO_SIX)).toBe(3);
  });

  it('follows the business-hours setting rather than a fixed 9 h', () => {
    expect(quoteResponseDaysOf(16, { from: '08:00', to: '16:00' })).toBe(2);
    expect(quoteResponseDaysOf(24, { from: '08:30', to: '17:30' })).toBe(3);
  });

  it('omits the timing without an SLA or a usable window', () => {
    for (const sla of [null, undefined, 0, -3, 'x']) expect(quoteResponseDaysOf(sla, NINE_TO_SIX)).toBeNull();
    for (const w of [null, {}, { from: '18:00', to: '09:00' }, { from: '9', to: '18:00' }, 'x'])
      expect(quoteResponseDaysOf(9, w)).toBeNull();
  });
});
