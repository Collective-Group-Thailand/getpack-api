import { addCalendarDays, bangkokDate, bangkokMinuteOfDay, startOfBangkokDay } from '@common/time/bangkok';

export interface TimeWindow {
  from: string;
  to: string;
}

const minutes = (hhmm: string) => {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};

/**
 * Marketing messages go out only inside `notifications.marketing_window` (Bangkok, D-144).
 * Returns `null` when `now` is inside the window, otherwise the next window start.
 */
export function nextMarketingSlot(now: Date, window: TimeWindow): Date | null {
  const from = minutes(window.from);
  const to = minutes(window.to);
  const current = bangkokMinuteOfDay(now);
  const inside = from <= to ? current >= from && current < to : current >= from || current < to;
  if (inside) return null;
  const today = bangkokDate(now);
  const day = from > current ? today : addCalendarDays(today, 1);
  return new Date(startOfBangkokDay(day).getTime() + from * 60_000);
}
