import {
  addCalendarDays,
  bangkokDate,
  bangkokDayOfWeek,
  bangkokMinuteOfDay,
  startOfBangkokDay,
  startOfBangkokMonth,
  toBangkokIso,
} from './bangkok';

describe('Bangkok time helpers', () => {
  it('maps UTC instants to Bangkok calendar days (UTC+7)', () => {
    expect(bangkokDate(new Date('2026-09-23T16:59:59Z'))).toBe('2026-09-23');
    expect(bangkokDate(new Date('2026-09-23T17:00:00Z'))).toBe('2026-09-24');
  });

  it('computes the day of week in Bangkok (0 = Sunday)', () => {
    // 2026-09-26 is a Saturday; 23:30 UTC Saturday is already Sunday in Bangkok.
    expect(bangkokDayOfWeek(new Date('2026-09-26T10:00:00Z'))).toBe(6);
    expect(bangkokDayOfWeek(new Date('2026-09-26T23:30:00Z'))).toBe(0);
  });

  it('returns 00:00 Bangkok as a UTC instant', () => {
    expect(startOfBangkokDay('2026-09-24').toISOString()).toBe('2026-09-23T17:00:00.000Z');
    expect(() => startOfBangkokDay('24/09/2026')).toThrow(RangeError);
  });

  it('adds calendar days across month and year ends', () => {
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('renders ISO 8601 with the +07:00 offset (contract §3)', () => {
    expect(toBangkokIso(new Date('2026-09-22T07:05:00Z'))).toBe('2026-09-22T14:05:00+07:00');
    expect(bangkokMinuteOfDay(new Date('2026-09-22T07:05:00Z'))).toBe(14 * 60 + 5);
  });

  it('starts the Bangkok month at local midnight on the 1st', () => {
    // 2026-10-31T18:30Z is already 1 November in Bangkok.
    expect(startOfBangkokMonth(new Date('2026-10-31T18:30:00Z')).toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(startOfBangkokMonth(new Date('2026-10-15T05:00:00Z')).toISOString()).toBe('2026-09-30T17:00:00.000Z');
  });
});
