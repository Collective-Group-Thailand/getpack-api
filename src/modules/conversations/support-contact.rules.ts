import { addCalendarDays, bangkokDate, bangkokDayOfWeek, startOfBangkokDay } from '@common/time/bangkok';

/**
 * D-458 (C10) pure rules of the contact page: when the team answers, which days a call back can be booked, which
 * queue a topic goes to, where a ticket stands and whether a guest may read it. No I/O: the service feeds settings
 * and the national calendar in.
 */

export type SupportDays = 'daily' | 'business_days' | 'mon_fri' | 'mon_sat';
export interface SupportHours {
  days: SupportDays;
  open: string;
  close: string;
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Whether CS answers on a Bangkok day (`YYYY-MM-DD`). */
export function answersOn(day: string, days: SupportDays, isWorkingDay: (day: string) => boolean): boolean {
  const dow = bangkokDayOfWeek(startOfBangkokDay(day));
  switch (days) {
    case 'daily':
      return true;
    case 'business_days':
      return isWorkingDay(day);
    case 'mon_fri':
      return dow >= 1 && dow <= 5;
    case 'mon_sat':
      return dow >= 1 && dow <= 6;
  }
}

/**
 * "ออนไลน์อยู่ตอนนี้" / "กลับมาตอบ hh:mm": open now when `now` falls in today's window on a day CS answers; else the
 * next opening instant within two weeks (null when none — a schedule with no open day).
 */
export function teamStatus(
  now: Date,
  hours: SupportHours,
  isWorkingDay: (day: string) => boolean,
): { openNow: boolean; nextOpenAt: Date | null } {
  const open = minutes(hours.open);
  const close = minutes(hours.close);
  if (close <= open) return { openNow: false, nextOpenAt: null };
  const today = bangkokDate(now);
  const nowMinutes = Math.floor((now.getTime() - startOfBangkokDay(today).getTime()) / 60_000);
  if (answersOn(today, hours.days, isWorkingDay) && nowMinutes >= open && nowMinutes < close)
    return { openNow: true, nextOpenAt: null };
  for (let offset = 0; offset <= 14; offset += 1) {
    const day = addCalendarDays(today, offset);
    if (!answersOn(day, hours.days, isWorkingDay)) continue;
    const at = new Date(startOfBangkokDay(day).getTime() + open * 60_000);
    if (at.getTime() > now.getTime()) return { openNow: false, nextOpenAt: at };
  }
  return { openNow: false, nextOpenAt: null };
}

/** The next `count` working days after today (Bangkok), the days a call back may be booked on. */
export function callbackDays(now: Date, isWorkingDay: (day: string) => boolean, count = 5): string[] {
  const out: string[] = [];
  let day = bangkokDate(now);
  for (let guard = 0; out.length < count && guard < 60; guard += 1) {
    day = addCalendarDays(day, 1);
    if (isWorkingDay(day)) out.push(day);
  }
  return out;
}

/** The queue a topic is routed to: the topic's own entry, else the default, else CS. */
export function queueFor(
  topic: string,
  routing: { default: string; topics: Record<string, string> } | null,
): string {
  return routing?.topics[topic] ?? routing?.default ?? 'cs';
}

export type TicketStage = 'received' | 'in_progress' | 'answered';

/**
 * Where a ticket stands for the person who sent it: answered once getpack replied (the ticket's first response or a
 * closed conversation), in progress once someone on the team took it (assigned or pending), received otherwise.
 */
export function ticketStage(
  ticket: { firstRespondedAt: Date | null },
  conversation: { status: 'open' | 'pending' | 'closed'; assignedUserId: bigint | null },
): TicketStage {
  if (ticket.firstRespondedAt !== null || conversation.status === 'closed') return 'answered';
  if (conversation.assignedUserId !== null || conversation.status === 'pending') return 'in_progress';
  return 'received';
}

const digits = (phone: string) => {
  const d = phone.replace(/\D/g, '');
  return d.startsWith('66') && d.length === 11 ? `0${d.slice(2)}` : d;
};

/** A guest proves a ticket is theirs with the phone or the e-mail they left on it (compared normalised). */
export function contactMatches(
  ticket: { contactPhone: string | null; contactEmail: string | null },
  given: { phone?: string; email?: string } | undefined,
): boolean {
  if (!given) return false;
  if (given.phone && ticket.contactPhone && digits(given.phone) === digits(ticket.contactPhone)) return true;
  if (given.email && ticket.contactEmail)
    return given.email.trim().toLowerCase() === ticket.contactEmail.trim().toLowerCase();
  return false;
}
