import { addCalendarDays, bangkokDate, bangkokDayOfWeek, MS_PER_DAY, startOfBangkokDay } from './bangkok';

/**
 * A resolved working-day calendar (D-161): weekend days plus explicit exceptions, all in Bangkok
 * calendar days. `nonWorking` holds holidays/closures that count (observance `all`), `extraWorking`
 * holds days worked despite being a weekend day.
 */
export interface WorkingDayRules {
  weekendDays: readonly number[];
  nonWorking: ReadonlySet<string>;
  extraWorking: ReadonlySet<string>;
}

/** Safety bound: no SLA or lead time spans more than this many calendar days. */
const MAX_SCAN_DAYS = 3660;

export class WorkingDayCalendar {
  constructor(private readonly rules: WorkingDayRules) {}

  isWorkingDay(day: string): boolean {
    if (this.rules.extraWorking.has(day)) return true;
    if (this.rules.nonWorking.has(day)) return false;
    const dow = bangkokDayOfWeek(startOfBangkokDay(day));
    return !this.rules.weekendDays.includes(dow);
  }

  /**
   * `start` moved forward by `days` working days, keeping the Bangkok time of day. A start on a
   * non-working day counts from 00:00 of the next working day.
   */
  addWorkingDays(start: Date, days: number): Date {
    if (!Number.isInteger(days) || days < 0) throw new RangeError('days must be a non-negative integer');
    let day = bangkokDate(start);
    let timeOfDay = start.getTime() - startOfBangkokDay(day).getTime();
    if (!this.isWorkingDay(day)) {
      day = this.nextWorkingDay(day);
      timeOfDay = 0;
    }
    for (let i = 0; i < days; i++) day = this.nextWorkingDay(day);
    return new Date(startOfBangkokDay(day).getTime() + timeOfDay);
  }

  /**
   * `start` moved forward by `minutes` of working time. Working time is every minute of a working
   * day; non-working days do not count (a working-hours window is not defined by any decision yet).
   */
  addWorkingMinutes(start: Date, minutes: number): Date {
    if (!Number.isInteger(minutes) || minutes < 0)
      throw new RangeError('minutes must be a non-negative integer');
    let remaining = minutes * 60_000;
    let cursor = start.getTime();
    for (let scanned = 0; scanned < MAX_SCAN_DAYS; scanned++) {
      const day = bangkokDate(new Date(cursor));
      const dayEnd = startOfBangkokDay(day).getTime() + MS_PER_DAY;
      if (this.isWorkingDay(day)) {
        const available = dayEnd - cursor;
        if (remaining <= available) return new Date(cursor + remaining);
        remaining -= available;
      }
      cursor = dayEnd;
    }
    throw new RangeError('working-time span exceeds the scan bound');
  }

  nextWorkingDay(day: string): string {
    let next = day;
    for (let scanned = 0; scanned < MAX_SCAN_DAYS; scanned++) {
      next = addCalendarDays(next, 1);
      if (this.isWorkingDay(next)) return next;
    }
    throw new RangeError('no working day within the scan bound');
  }
}
