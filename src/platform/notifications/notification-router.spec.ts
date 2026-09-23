import { decide } from './notification-router';

const base = {
  channel: 'email' as const,
  category: 'transactional' as const,
  isCritical: false,
  isMarketing: false,
  preferenceEnabled: undefined,
  marketingConsent: false,
  now: new Date('2026-09-23T14:00:00+07:00'),
  window: { from: '09:00', to: '20:00' },
};

describe('notification routing rules (D-143, D-144)', () => {
  it('sends SMS only for critical routes', () => {
    expect(decide({ ...base, channel: 'sms' })).toEqual({ send: false, reason: 'sms_not_critical' });
    expect(decide({ ...base, channel: 'sms', isCritical: true })).toMatchObject({
      send: true,
      status: 'queued',
    });
  });

  it('never lets transactional e-mail be switched off, but honours other channel choices', () => {
    expect(decide({ ...base, preferenceEnabled: false })).toMatchObject({ send: true, status: 'queued' });
    expect(decide({ ...base, channel: 'line', preferenceEnabled: false })).toEqual({
      send: false,
      reason: 'opted_out',
    });
    expect(decide({ ...base, channel: 'in_app' })).toMatchObject({ send: true, status: 'queued' });
  });

  it('suppresses marketing without PDPA consent and drops it when the user opted out', () => {
    const marketing = { ...base, channel: 'line' as const, isMarketing: true };
    expect(decide(marketing)).toEqual({ send: true, status: 'suppressed_no_consent', scheduledFor: null });
    expect(decide({ ...marketing, marketingConsent: true, preferenceEnabled: false })).toEqual({
      send: false,
      reason: 'opted_out',
    });
    expect(decide({ ...base, category: 'marketing', marketingConsent: true })).toMatchObject({
      status: 'queued',
    });
  });

  it('defers consented marketing outside 09:00–20:00 Bangkok to the next window', () => {
    const marketing = { ...base, channel: 'line' as const, isMarketing: true, marketingConsent: true };
    expect(decide(marketing)).toEqual({ send: true, status: 'queued', scheduledFor: null });
    expect(decide({ ...marketing, now: new Date('2026-09-23T21:30:00+07:00') })).toEqual({
      send: true,
      status: 'deferred_quiet_hours',
      scheduledFor: new Date('2026-09-24T09:00:00+07:00'),
    });
  });
});
