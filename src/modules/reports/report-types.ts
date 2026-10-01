import { type PrismaService } from '@database/prisma.service';
import { type PermissionKey } from '@modules/iam/permissions.catalog';

/**
 * Operational reports (B6.2): each report is a definition in code — its columns, filters and the permission of
 * the data it shows — with a row generator that pages through the database, so a report of any size streams
 * into the XLSX / CSV writer without being held in memory.
 */

export const COLUMN_TYPES = [
  'text',
  'integer',
  'money',
  'decimal',
  'percent',
  'date',
  'datetime',
  'boolean',
] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export interface ReportColumn {
  key: string;
  labelTh: string;
  labelEn: string;
  type: ColumnType;
  /** Summed in the totals row; default: money and integer columns (U-B0.3). */
  total?: boolean;
}

/** Whether a column is added up in the totals row: money and counts, unless the column says not to. */
export const isTotalled = (c: ReportColumn): boolean =>
  c.total ?? (c.type === 'money' || c.type === 'integer');

/** The menu group of each report (U-B0.3); the frontend owns the label. */
export const REPORT_GROUPS = ['sales', 'finance', 'marketing', 'operations'] as const;
export type ReportGroup = (typeof REPORT_GROUPS)[number];
export const GROUP_OF: Record<string, ReportGroup> = {
  sales: 'sales',
  orders: 'sales',
  quotations: 'sales',
  sales_tax: 'finance',
  payments_by_channel: 'finance',
  ar_aging: 'finance',
  ap_aging: 'finance',
  payout_history: 'finance',
  points_liability: 'finance',
  campaign_usage: 'marketing',
  factory_scorecards: 'operations',
  claims: 'operations',
};

export const FILTER_KINDS = ['range', 'as_of', 'month', 'enum', 'uuid'] as const;
export type FilterKind = (typeof FILTER_KINDS)[number];

/** `range` → `from` + `to`; `as_of` → `asOf`; `month` → `month`; `enum` / `uuid` → the filter's own key. */
export interface ReportFilter {
  key: 'period' | 'channel' | 'productTypeId' | 'factoryId' | 'status' | 'provider';
  kind: FilterKind;
  required: boolean;
  values?: readonly string[];
}

export type Cell = string | number | boolean | null;
export type ReportRow = Record<string, Cell>;

export interface ResolvedFilters {
  from?: string;
  to?: string;
  asOf?: string;
  month?: string;
  channel?: string;
  productTypeId?: string;
  factoryId?: string;
  status?: string;
  provider?: string;
}

export interface ReportContext {
  prisma: PrismaService;
  filters: ResolvedFilters;
  /** Report-specific services, resolved lazily from the module. */
  get: <T>(token: abstract new (...args: never[]) => T) => T;
}

export interface ReportDefinition {
  key: string;
  nameTh: string;
  nameEn: string;
  description: string;
  decisions: readonly string[];
  /** The permission of the data shown; exports also need `reports.export`. */
  permission: PermissionKey;
  filters: readonly ReportFilter[];
  columns: readonly ReportColumn[];
  rows(ctx: ReportContext): AsyncIterable<ReportRow>;
}

/** Keyset paging over any id-ordered query (500 rows per round trip). */
export async function* paged<T extends { id: bigint }>(
  fetch: (afterId: bigint, take: number) => Promise<T[]>,
  take = 500,
): AsyncGenerator<T> {
  let after = 0n;
  for (;;) {
    const batch = await fetch(after, take);
    for (const row of batch) yield row;
    if (batch.length < take) return;
    after = batch.at(-1)!.id;
  }
}
