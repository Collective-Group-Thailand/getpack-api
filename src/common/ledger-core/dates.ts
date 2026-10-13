import { bangkokDate } from '@common/time/bangkok';

/**
 * Business dates of the ledger are `YYYY-MM-DD` in Asia/Bangkok (schema-design §1.3); `date` columns
 * travel through Prisma as UTC midnight of that day.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(value: unknown): value is string {
  return typeof value === 'string' && DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** `YYYY-MM-DD` → the `Date` Prisma writes to a `date` column. */
export function dateOnly(day: string): Date {
  if (!isDay(day)) throw new RangeError(`Not a date: ${String(day)}`);
  return new Date(`${day}T00:00:00.000Z`);
}

/** A `date` column value → `YYYY-MM-DD`. */
export function dayOf(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** A payload date: `YYYY-MM-DD` as is, an ISO instant as its Bangkok day. */
export function businessDay(value: string | Date): string {
  if (value instanceof Date) return bangkokDate(value);
  if (isDay(value)) return value;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new RangeError(`Not a date: ${String(value)}`);
  return bangkokDate(instant);
}

/** Last day of the month of `day`. */
export function monthEnd(day: string): string {
  const [y, m] = day.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** First day of the month `offset` months after the month of `day`. */
export function addMonths(day: string, offset: number): string {
  const [y, m] = day.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 10);
}
