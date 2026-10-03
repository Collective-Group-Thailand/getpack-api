import { WorkingDayCalendar } from './working-days';

// Week of 2026-09-21 (Mon) … 2026-09-27 (Sun); weekend = Sat (6), Sun (0).
const calendar = new WorkingDayCalendar({
  weekendDays: [0, 6],
  nonWorking: new Set(['2026-09-23']), // a Wednesday holiday observed by all
  extraWorking: new Set(['2026-09-26']), // a Saturday worked
});
const at = (iso: string) => new Date(iso);

describe('WorkingDayCalendar (D-161)', () => {
  it('classifies weekends, holidays and extra working days', () => {
    expect(calendar.isWorkingDay('2026-09-22')).toBe(true);
    expect(calendar.isWorkingDay('2026-09-23')).toBe(false);
    expect(calendar.isWorkingDay('2026-09-26')).toBe(true);
    expect(calendar.isWorkingDay('2026-09-27')).toBe(false);
  });

  it('adds working days keeping the Bangkok time of day and skipping the holiday', () => {
    // Tue 10:00 Bangkok + 1 working day = Thu 10:00 (Wed is a holiday).
    expect(calendar.addWorkingDays(at('2026-09-22T03:00:00Z'), 1).toISOString()).toBe(
      '2026-09-24T03:00:00.000Z',
    );
    // Fri + 1 = Sat (extra working day); Fri + 2 = Mon.
    expect(calendar.addWorkingDays(at('2026-09-25T03:00:00Z'), 1).toISOString()).toBe(
      '2026-09-26T03:00:00.000Z',
    );
    expect(calendar.addWorkingDays(at('2026-09-25T03:00:00Z'), 2).toISOString()).toBe(
      '2026-09-28T03:00:00.000Z',
    );
  });

  it('counts from 00:00 of the next working day when starting on a non-working day', () => {
    // Wed (holiday) 15:00 + 0 → Thu 00:00 Bangkok; + 1 → Fri 00:00.
    expect(calendar.addWorkingDays(at('2026-09-23T08:00:00Z'), 0).toISOString()).toBe(
      '2026-09-23T17:00:00.000Z',
    );
    expect(calendar.addWorkingDays(at('2026-09-23T08:00:00Z'), 1).toISOString()).toBe(
      '2026-09-24T17:00:00.000Z',
    );
  });

  it('adds working minutes across a non-working day', () => {
    // Tue 22:00 Bangkok + 4 h: 2 h left on Tue, Wed skipped, 2 h into Thu → Thu 02:00 Bangkok.
    expect(calendar.addWorkingMinutes(at('2026-09-22T15:00:00Z'), 240).toISOString()).toBe(
      '2026-09-23T19:00:00.000Z',
    );
    expect(calendar.addWorkingMinutes(at('2026-09-22T03:00:00Z'), 0).toISOString()).toBe(
      '2026-09-22T03:00:00.000Z',
    );
  });

  it('rejects negative or fractional spans', () => {
    expect(() => calendar.addWorkingDays(new Date(), -1)).toThrow(RangeError);
    expect(() => calendar.addWorkingMinutes(new Date(), 1.5)).toThrow(RangeError);
  });
});

describe('WorkingDayCalendar weekly hours (D-292)', () => {
  const mon = { from: '08:00', to: '17:00' };
  const sat = { from: '08:00', to: '12:00' };
  // From 2026-11-02 the factory works Saturday mornings and not Monday.
  const calendar = new WorkingDayCalendar({
    weekendDays: [0, 6],
    nonWorking: new Set(['2026-11-04']),
    extraWorking: new Set(),
    weekly: [{ from: '2026-11-02', days: [null, null, mon, mon, mon, mon, sat] }],
  });

  it('replaces the weekend from its effective day, holidays and closures still apply', () => {
    expect(calendar.isWorkingDay('2026-10-26')).toBe(true); // a Monday before the version
    expect(calendar.isWorkingDay('2026-10-31')).toBe(false); // a Saturday before it
    expect(calendar.isWorkingDay('2026-11-02')).toBe(false); // Monday: no hours
    expect(calendar.isWorkingDay('2026-11-07')).toBe(true); // Saturday: hours
    expect(calendar.isWorkingDay('2026-11-04')).toBe(false); // a closure on a working weekday
    expect(calendar.hoursOn('2026-11-07')).toEqual(sat);
    expect(calendar.hoursOn('2026-10-26')).toBeNull();
  });

  it('counts business time inside each day’s own window', () => {
    // Friday 2026-11-06 16:00 + 3 h: 1 h Friday, 2 h Saturday from 08:00 → Saturday 10:00 (Bangkok).
    const start = new Date('2026-11-06T09:00:00Z');
    expect(calendar.addBusinessMinutes(start, 180, { from: '09:00', to: '18:00' }).toISOString()).toBe(
      '2026-11-07T03:00:00.000Z',
    );
  });
});
