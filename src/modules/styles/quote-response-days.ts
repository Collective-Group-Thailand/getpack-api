/**
 * C1c (owner decision 2026-10-28, DECISIONS-STAGE-A §11.2): the quotation first-response time shown on quote-only
 * styles — "ทีมงานตอบภายใน {n} วันทำการ" — is `ceil(rfq.sla_business_hours ÷ hours of one business day)`, the business
 * day being the `calendar.business_hours` window (D-175; 09:00–18:00 = 9 h). Never a hard-coded day length: without a
 * positive SLA or a usable window (malformed, zero or negative length) the timing is omitted (null). Pure.
 */
export function quoteResponseDaysOf(slaHours: unknown, window: unknown): number | null {
  const hours = typeof slaHours === 'number' ? slaHours : Number(slaHours);
  if (slaHours === null || slaHours === undefined || !Number.isFinite(hours) || hours <= 0) return null;
  const perDay = businessDayHours(window);
  if (perDay === null) return null;
  // A tolerance keeps 18 h ÷ 9 h at exactly 2 days.
  return Math.max(1, Math.ceil(hours / perDay - 1e-9));
}

/** Hours of one business day from a `time_of_day_window` value (`{ from: 'HH:MM', to: 'HH:MM' }`), or null. */
export function businessDayHours(window: unknown): number | null {
  if (window === null || typeof window !== 'object') return null;
  const w = window as Record<string, unknown>;
  const minutes = (v: unknown): number | null => {
    if (typeof v !== 'string') return null;
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const from = minutes(w['from']);
  const to = minutes(w['to']);
  if (from === null || to === null || to <= from) return null;
  return (to - from) / 60;
}
