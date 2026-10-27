import { bangkokDate } from '@common/time/bangkok';
import { type WorkingDayCalendar } from '@common/time/working-days';

/**
 * C4-API-3: carrier transit time per destination shipping zone, in working days of the national business calendar.
 * The value of the effective-dated setting `shipping.transit_days` (ADR-0005, Admin, audited); `zones` is keyed by the
 * shipping zone code, any zone not listed uses `default`.
 */
export interface TransitDaysValue {
  default: TransitDays;
  zones: Record<string, TransitDays>;
}

export interface TransitDays {
  min: number;
  max: number;
}

export interface ArrivalWindow {
  /** Bangkok calendar day (YYYY-MM-DD). */
  from: string;
  to: string;
}

const validDays = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/**
 * The transit window of `zoneCode`: the zone's own entry, else the default. A malformed entry falls back to the
 * default; a `max` below `min` is read as `min` (the window never runs backwards). Null when nothing usable is set.
 */
export function transitFor(value: TransitDaysValue | null | undefined, zoneCode: string): TransitDays | null {
  if (!value) return null;
  const usable = (t: TransitDays | undefined): TransitDays | null =>
    t && validDays(t.min) && validDays(t.max) ? { min: t.min, max: Math.max(t.min, t.max) } : null;
  return usable(value.zones?.[zoneCode]) ?? usable(value.default);
}

/**
 * arrival.from = ready date + min working days, arrival.to = ready date + max working days (weekends and the
 * calendar's holidays skipped). `readyDate` is the earliest ship date (Bangkok day).
 */
export function arrivalWindow(
  calendar: WorkingDayCalendar,
  readyDate: string,
  transit: TransitDays,
): ArrivalWindow {
  const start = new Date(`${readyDate}T00:00:00+07:00`);
  return {
    from: bangkokDate(calendar.addWorkingDays(start, transit.min)),
    to: bangkokDate(calendar.addWorkingDays(start, transit.max)),
  };
}
