import { addCalendarDays, bangkokDate, bangkokDayOfWeek } from '@common/time/bangkok';

import { type ReportDefinition, type ResolvedFilters } from './report-types';

/**
 * Report filters (B6.2): explicit dates, or a relative `period` resolved at run time in Asia/Bangkok — what a
 * scheduled report stores, so "last month" always means the month before the run.
 */
export const RELATIVE_PERIODS = [
  'previous_day',
  'previous_week',
  'previous_month',
  'month_to_date',
  'year_to_date',
] as const;
export type RelativePeriod = (typeof RELATIVE_PERIODS)[number];

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A report covers at most a year and a day (technical bound on one file). */
export const MAX_REPORT_DAYS = 367;

export interface FilterError {
  path: string;
  code: string;
  message: string;
}

const validDay = (d: unknown): d is string =>
  typeof d === 'string' && DAY.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
/** The Bangkok date range of a relative period at `now`. */
export function periodRange(period: RelativePeriod, now: Date): { from: string; to: string } {
  const today = bangkokDate(now);
  const yesterday = addCalendarDays(today, -1);
  switch (period) {
    case 'previous_day':
      return { from: yesterday, to: yesterday };
    case 'previous_week': {
      // ISO week: Monday–Sunday before the current week.
      const monday = addCalendarDays(today, -(((bangkokDayOfWeek(now) + 6) % 7) + 7));
      return { from: monday, to: addCalendarDays(monday, 6) };
    }
    case 'previous_month': {
      const firstOfThis = `${today.slice(0, 7)}-01`;
      const last = addCalendarDays(firstOfThis, -1);
      return { from: `${last.slice(0, 7)}-01`, to: last };
    }
    case 'month_to_date':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'year_to_date':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

/**
 * Validates `raw` against the report's filters and resolves relative periods. `range` takes `from` + `to` or
 * `period`; `as_of` takes `asOf` or `period` (its last day); `month` takes `month` or `period` (its first month).
 */
export function resolveFilters(
  def: Pick<ReportDefinition, 'filters'>,
  raw: Record<string, unknown>,
  now = new Date(),
): { filters: ResolvedFilters; errors: FilterError[] } {
  const errors: FilterError[] = [];
  const out: ResolvedFilters = {};
  const period = raw['period'];
  if (period !== undefined && !RELATIVE_PERIODS.includes(period as RelativePeriod))
    errors.push({ path: 'period', code: 'enum', message: `one of ${RELATIVE_PERIODS.join(', ')}` });
  const relative =
    period !== undefined && RELATIVE_PERIODS.includes(period as RelativePeriod)
      ? periodRange(period as RelativePeriod, now)
      : null;
  for (const f of def.filters) {
    switch (f.kind) {
      case 'range': {
        const from = raw['from'] ?? relative?.from;
        const to = raw['to'] ?? relative?.to;
        if (from === undefined && to === undefined) {
          if (f.required)
            errors.push({ path: 'from', code: 'required', message: 'from and to (or period) are required' });
          break;
        }
        if (!validDay(from)) errors.push({ path: 'from', code: 'pattern', message: 'YYYY-MM-DD' });
        if (!validDay(to)) errors.push({ path: 'to', code: 'pattern', message: 'YYYY-MM-DD' });
        if (validDay(from) && validDay(to)) {
          const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
          if (days < 1 || days > MAX_REPORT_DAYS)
            errors.push({ path: 'to', code: 'range', message: `from ≤ to, at most ${MAX_REPORT_DAYS} days` });
          else Object.assign(out, { from, to });
        }
        break;
      }
      case 'as_of': {
        const asOf = raw['asOf'] ?? relative?.to;
        if (asOf === undefined) {
          if (f.required)
            errors.push({ path: 'asOf', code: 'required', message: 'asOf (or period) is required' });
        } else if (!validDay(asOf)) errors.push({ path: 'asOf', code: 'pattern', message: 'YYYY-MM-DD' });
        else out.asOf = asOf;
        break;
      }
      case 'month': {
        const month = raw['month'] ?? relative?.from.slice(0, 7);
        if (month === undefined) {
          if (f.required)
            errors.push({ path: 'month', code: 'required', message: 'month (or period) is required' });
        } else if (typeof month !== 'string' || !MONTH.test(month))
          errors.push({ path: 'month', code: 'pattern', message: 'YYYY-MM' });
        else out.month = month;
        break;
      }
      case 'enum':
      case 'uuid': {
        const given = raw[f.key];
        const value =
          typeof given === 'string' || typeof given === 'number'
            ? String(given)
            : given === undefined
              ? undefined
              : JSON.stringify(given);
        if (value === undefined || value === '') {
          if (f.required) errors.push({ path: f.key, code: 'required', message: `${f.key} is required` });
        } else if (f.kind === 'enum' && !f.values?.includes(value))
          errors.push({ path: f.key, code: 'enum', message: `one of ${f.values?.join(', ')}` });
        else if (f.kind === 'uuid' && !UUID.test(value))
          errors.push({ path: f.key, code: 'format', message: 'uuid' });
        else (out as Record<string, string>)[f.key] = value;
        break;
      }
    }
  }
  const dateKeys: Record<string, string[]> = { range: ['from', 'to'], as_of: ['asOf'], month: ['month'] };
  const known = new Set(['period', ...def.filters.flatMap((f) => dateKeys[f.kind] ?? [f.key])]);
  for (const key of Object.keys(raw))
    if (!known.has(key)) errors.push({ path: key, code: 'unknown', message: 'not a filter of this report' });
  return { filters: out, errors };
}
