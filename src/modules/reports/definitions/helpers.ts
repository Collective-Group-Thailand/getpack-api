import { addCalendarDays, startOfBangkokDay, toBangkokIso } from '@common/time/bangkok';

import { type ReportColumn, type ResolvedFilters } from '../report-types';

/** `[from 00:00, to + 1 day 00:00)` in Asia/Bangkok. */
export function bangkokRange(f: ResolvedFilters): { gte: Date; lt: Date } {
  return { gte: startOfBangkokDay(f.from!), lt: startOfBangkokDay(addCalendarDays(f.to!, 1)) };
}

export const iso = (d: Date | null | undefined): string | null => (d ? toBangkokIso(d) : null);
export const day = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
export const money = (v: { toFixed(n: number): string } | null | undefined): string | null =>
  v === null || v === undefined ? null : v.toFixed(2);
export const pct = (v: { toFixed(n: number): string } | null | undefined): string | null =>
  v === null || v === undefined ? null : v.toFixed(2);

/** Column shorthand: `col('orderCode', 'เลขที่คำสั่งซื้อ', 'Order no.')`. */
export const col = (
  key: string,
  labelTh: string,
  labelEn: string,
  type: ReportColumn['type'] = 'text',
): ReportColumn => ({ key, labelTh, labelEn, type });
