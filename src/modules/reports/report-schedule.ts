import { addCalendarDays, bangkokDate, bangkokDayOfWeek, startOfBangkokDay } from '@common/time/bangkok';

/** When a scheduled report runs next (Asia/Bangkok, no daylight saving). */
export interface ScheduleTiming {
  frequency: 'daily' | 'weekly' | 'monthly';
  /** Minutes after midnight. */
  runAtMinute: number;
  /** ISO weekday, 1 = Monday (weekly). */
  dayOfWeek: number | null;
  /** 1–28 (monthly). */
  dayOfMonth: number | null;
}

const at = (day: string, minute: number) => new Date(startOfBangkokDay(day).getTime() + minute * 60_000);

/** The first run strictly after `after`. */
export function nextRunAt(s: ScheduleTiming, after: Date): Date {
  const today = bangkokDate(after);
  switch (s.frequency) {
    case 'daily': {
      const candidate = at(today, s.runAtMinute);
      return candidate > after ? candidate : at(addCalendarDays(today, 1), s.runAtMinute);
    }
    case 'weekly': {
      const isoToday = ((bangkokDayOfWeek(after) + 6) % 7) + 1;
      let offset = (s.dayOfWeek! - isoToday + 7) % 7;
      if (offset === 0 && at(today, s.runAtMinute) <= after) offset = 7;
      return at(addCalendarDays(today, offset), s.runAtMinute);
    }
    case 'monthly': {
      const day = String(s.dayOfMonth!).padStart(2, '0');
      const thisMonth = at(`${today.slice(0, 7)}-${day}`, s.runAtMinute);
      if (thisMonth > after) return thisMonth;
      const next = addCalendarDays(`${today.slice(0, 7)}-28`, 4).slice(0, 7);
      return at(`${next}-${day}`, s.runAtMinute);
    }
  }
}

/** `HH:MM` ↔ minutes after midnight. */
export function parseTimeOfDay(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function formatTimeOfDay(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
