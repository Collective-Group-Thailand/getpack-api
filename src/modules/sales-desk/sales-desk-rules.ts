import { WorkingDayCalendar } from '@common/time/working-days';

/**
 * D-469: pure rules of the company sales desk — the working-hours SLA (P-05: "ทุกวัน 09:00–18:00", every day inside
 * the `calendar.business_hours` window), the round-robin pick and the inbound status moves. No I/O.
 */

/** P-05 counts every day of the week; the window comes from `calendar.business_hours`. */
const EVERY_DAY = new WorkingDayCalendar({ weekendDays: [], nonWorking: new Set(), extraWorking: new Set() });

/** `from` moved forward by `hours` of working time inside `window` (Bangkok), every day (P-05). */
export function workingHoursDue(from: Date, hours: number, window: { from: string; to: string }): Date {
  return EVERY_DAY.addBusinessMinutes(from, Math.round(hours * 60), window);
}

export interface RepLoad {
  userId: bigint;
  open: number;
  /** When the rep was last given an enquiry (null = never). */
  lastAssignedAt: Date | null;
}

/**
 * Round robin among assignable reps: the fewest open enquiries below the capacity (`sales.max_open_per_rep`, null =
 * no cap), ties by the least recently assigned (never first), then the lowest user id. Null when nobody has room.
 */
export function pickRep(reps: readonly RepLoad[], capacity: number | null): bigint | null {
  const room = reps.filter((r) => capacity === null || r.open < capacity);
  if (room.length === 0) return null;
  const sorted = [...room].sort(
    (a, b) =>
      a.open - b.open ||
      (a.lastAssignedAt?.getTime() ?? -1) - (b.lastAssignedAt?.getTime() ?? -1) ||
      (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  );
  return sorted[0]!.userId;
}

export const INBOUND_STATUSES = [
  'new',
  'assigned',
  'contacted',
  'converted_to_lead',
  'disqualified',
] as const;
export type InboundStatus = (typeof INBOUND_STATUSES)[number];
export const INBOUND_SOURCES = ['contact_form', 'rfq', 'line_chat', 'manual'] as const;
export const DISQUALIFY_REASONS = [
  'not_a_buyer',
  'duplicate',
  'no_response',
  'out_of_scope',
  'spam',
  'other',
] as const;
export const CLOSED_INBOUND: readonly InboundStatus[] = ['converted_to_lead', 'disqualified'];

export function isClosed(status: InboundStatus): boolean {
  return CLOSED_INBOUND.includes(status);
}

/** The first response is the first `contacted` (or a later close by the assignee); an SLA breach is past due. */
export function slaBreached(
  row: { firstResponseDueAt: Date; firstRespondedAt: Date | null; slaBreachedAt: Date | null },
  now: Date,
): boolean {
  return row.firstRespondedAt === null && row.slaBreachedAt === null && row.firstResponseDueAt <= now;
}

/** First-response SLA %: answered on time ÷ due by now (answered or overdue), one decimal; null when none due. */
export function slaPct(rows: readonly { due: Date; respondedAt: Date | null }[], now: Date): string | null {
  const due = rows.filter((r) => r.respondedAt !== null || r.due <= now);
  if (due.length === 0) return null;
  const onTime = due.filter((r) => r.respondedAt !== null && r.respondedAt <= r.due).length;
  return ((onTime * 100) / due.length).toFixed(1);
}
