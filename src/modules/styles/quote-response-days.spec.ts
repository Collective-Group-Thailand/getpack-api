import { SettingNotFoundError } from '@platform/settings/settings.service';

import { businessDayHours, quoteResponseDaysFor, quoteResponseDaysOf } from './quote-response-days';

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

describe('quoteResponseDaysFor (C1f: style cards and the product page, D-451)', () => {
  const reader = (values: Record<string, unknown>) => ({
    at: jest.fn((key: string) =>
      key in values
        ? Promise.resolve({ value: values[key] })
        : Promise.reject(new SettingNotFoundError(key, new Date())),
    ),
  });

  it('reads the SLA at the product type and the business day', async () => {
    const settings = reader({ 'rfq.sla_business_hours': 18, 'calendar.business_hours': NINE_TO_SIX });
    await expect(quoteResponseDaysFor(settings, 7n)).resolves.toBe(2);
    expect(settings.at).toHaveBeenCalledWith('rfq.sla_business_hours', {
      scope: { type: 'product_type', id: 7n },
    });
  });

  it('omits the timing when a setting is missing, and rethrows anything else', async () => {
    await expect(
      quoteResponseDaysFor(reader({ 'calendar.business_hours': NINE_TO_SIX }), 7n),
    ).resolves.toBeNull();
    await expect(
      quoteResponseDaysFor({ at: () => Promise.reject(new Error('db down')) }, 7n),
    ).rejects.toThrow('db down');
  });
});
