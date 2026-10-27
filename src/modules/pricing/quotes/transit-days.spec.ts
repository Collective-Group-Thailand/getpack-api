import { WorkingDayCalendar } from '@common/time/working-days';

import { arrivalWindow, type TransitDaysValue, transitFor } from './transit-days';

// Week of 2026-11-02 (Mon) … 2026-11-08 (Sun); weekend Sat/Sun; Wed 2026-11-04 a holiday for this test.
const calendar = new WorkingDayCalendar({
  weekendDays: [0, 6],
  nonWorking: new Set(['2026-11-04']),
  extraWorking: new Set(),
});

const value: TransitDaysValue = {
  default: { min: 3, max: 5 },
  zones: { bkk: { min: 1, max: 2 }, central_east: { min: 2, max: 3 } },
};

describe('C4-API-3 transit days', () => {
  it('uses the zone entry, else the default', () => {
    expect(transitFor(value, 'bkk')).toEqual({ min: 1, max: 2 });
    expect(transitFor(value, 'central_east')).toEqual({ min: 2, max: 3 });
    expect(transitFor(value, 'south')).toEqual({ min: 3, max: 5 });
  });

  it('never runs backwards and ignores malformed entries', () => {
    expect(transitFor({ default: { min: 3, max: 5 }, zones: { z: { min: 4, max: 2 } } }, 'z')).toEqual({
      min: 4,
      max: 4,
    });
    expect(transitFor({ default: { min: 3, max: 5 }, zones: { z: { min: -1, max: 2 } } }, 'z')).toEqual({
      min: 3,
      max: 5,
    });
    expect(transitFor(null, 'z')).toBeNull();
    expect(transitFor({ default: { min: 1.5, max: 2 }, zones: {} }, 'z')).toBeNull();
  });

  it('from = ready + min, to = ready + max working days, skipping weekends and holidays', () => {
    // Ready Mon 11-02: +1 → Tue 11-03; +2 → Thu 11-05 (Wed holiday).
    expect(arrivalWindow(calendar, '2026-11-02', { min: 1, max: 2 })).toEqual({
      from: '2026-11-03',
      to: '2026-11-05',
    });
    // Ready Thu 11-05: +3 → Tue 11-10; +5 → Thu 11-12 (weekend skipped).
    expect(arrivalWindow(calendar, '2026-11-05', { min: 3, max: 5 })).toEqual({
      from: '2026-11-10',
      to: '2026-11-12',
    });
  });

  it('a single date when min equals max', () => {
    const w = arrivalWindow(calendar, '2026-11-02', { min: 2, max: 2 });
    expect(w.from).toBe(w.to);
  });
});
