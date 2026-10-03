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
  /**
   * D-292 a factory's weekly hours, effective-dated (oldest first): from `from` (a Bangkok day) on, a day of week
   * (0 = Sunday) with no hours is not worked and a day with hours is — they replace `weekendDays` — and business
   * time counts inside that day's window instead of `calendar.business_hours`.
   */
  weekly?: readonly WeeklyHours[];
}

export interface DayHours {
  from: string;
  to: string;
}

export interface WeeklyHours {
  from: string;
  /** Indexed by day of week, 0 = Sunday. */
  days: readonly (DayHours | null)[];
}

/** Safety bound: no SLA or lead time spans more than this many calendar days. */
const MAX_SCAN_DAYS = 3660;

export class WorkingDayCalendar {
  constructor(private readonly rules: WorkingDayRules) {}

  isWorkingDay(day: string): boolean {
    if (this.rules.extraWorking.has(day)) return true;
    if (this.rules.nonWorking.has(day)) return false;
    const dow = bangkokDayOfWeek(startOfBangkokDay(day));
    const weekly = this.weeklyOn(day);
    if (weekly) return weekly.days[dow] !== null && weekly.days[dow] !== undefined;
    return !this.rules.weekendDays.includes(dow);
  }

  /** D-292: the factory's hours on `day` when its weekly hours define them, else null. */
  hoursOn(day: string): DayHours | null {
    const weekly = this.weeklyOn(day);
    return weekly ? (weekly.days[bangkokDayOfWeek(startOfBangkokDay(day))] ?? null) : null;
  }

  private weeklyOn(day: string): WeeklyHours | undefined {
    const versions = this.rules.weekly;
    if (!versions?.length) return undefined;
    let found: WeeklyHours | undefined;
    for (const v of versions) if (v.from <= day) found = v;
    return found;
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

  /**
   * `start` moved forward by `minutes` of **business time**: only minutes inside `window` (Bangkok
   * `HH:mm`–`HH:mm`, D-175) on working days count. A start outside the window counts from the next
   * window opening.
   */
  addBusinessMinutes(start: Date, minutes: number, window: { from: string; to: string }): Date {
    if (!Number.isInteger(minutes) || minutes < 0)
      throw new RangeError('minutes must be a non-negative integer');
    const offset = (hhmm: string) => {
      const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
      if (!m) throw new RangeError(`not a time of day: ${hhmm}`);
      return (Number(m[1]) * 60 + Number(m[2])) * 60_000;
    };
    if (offset(window.to) <= offset(window.from))
      throw new RangeError('the business-hours window must end after it starts');
    let remaining = minutes * 60_000;
    let cursor = start.getTime();
    for (let scanned = 0; scanned < MAX_SCAN_DAYS; scanned++) {
      const day = bangkokDate(new Date(cursor));
      const dayStart = startOfBangkokDay(day).getTime();
      // D-292: a factory's own hours replace the platform window on the days they define.
      const hours = this.hoursOn(day) ?? window;
      const open = offset(hours.from);
      const close = offset(hours.to);
      if (this.isWorkingDay(day) && close > open) {
        const from = Math.max(cursor, dayStart + open);
        const to = dayStart + close;
        if (from < to) {
          if (remaining <= to - from) return new Date(from + remaining);
          remaining -= to - from;
        }
      }
      cursor = dayStart + MS_PER_DAY;
    }
    throw new RangeError('business-time span exceeds the scan bound');
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
