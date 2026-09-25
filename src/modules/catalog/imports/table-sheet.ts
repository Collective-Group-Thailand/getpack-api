import { type Tx } from '@database/prisma.service';
import { Prisma } from '@generated/prisma/client';

import {
  canonical,
  type ColumnSpec,
  type ExistingRow,
  type ParsedRow,
  type SheetSpec,
} from './import-engine';
import { type CellValue } from './workbook';

type Row = Record<string, unknown>;

interface WritableTable {
  findMany(args: object): Promise<Row[]>;
  createMany(args: { data: object[] }): Promise<unknown>;
  update(args: { where: { id: bigint }; data: object }): Promise<unknown>;
}

const CHUNK = 1_000;

/**
 * Sheet over one catalogue table with a natural key. Creates go through `createMany` in chunks;
 * updates bump `row_version` (ETags of edited rows change) and record the importing user.
 */
export function tableSheet(options: {
  name: string;
  table: (db: Tx) => WritableTable;
  columns: ColumnSpec[];
  /** Key headers (in order) and how to find existing rows for the parsed keys. */
  key: string[];
  where: (rows: ParsedRow[]) => object;
  /** Natural key of a stored row (with `include`d relations), e.g. `row.code`. */
  keyOf: (row: Row) => string;
  orderBy: object;
  /** Relations the key or export need (ref columns are added automatically). */
  include?: Record<string, unknown>;
  /** Extra data written on create (e.g. a fixed product type). */
  createDefaults?: Row;
}): SheetSpec {
  const refInclude = Object.fromEntries(
    options.columns
      .filter((c) => c.type === 'ref')
      .map((c) => [c.ref!.relation, { select: { [c.ref!.by]: true } }]),
  );
  const include = { ...refInclude, ...options.include };
  const fields = options.columns.map((c) => c.field);

  const toDb = (data: Row): Row =>
    Object.fromEntries(
      Object.entries(data).map(([field, value]) => {
        const column = options.columns.find((c) => c.field === field);
        if (column?.type === 'json') return [field, value === null ? Prisma.DbNull : value];
        return [field, value];
      }),
    );

  return {
    name: options.name,
    columns: options.columns,
    key: options.key,
    async existing(db, rows) {
      const map = new Map<string, ExistingRow>();
      if (rows.length === 0) return map;
      const stored = await options.table(db).findMany({ where: options.where(rows), include });
      for (const row of stored) {
        map.set(options.keyOf(row), {
          id: row['id'] as bigint,
          values: Object.fromEntries(fields.map((f) => [f, row[f]])),
        });
      }
      return map;
    },
    async apply(db, rows, actorUserId) {
      const creates = rows.filter((r) => r.action === 'create');
      for (let i = 0; i < creates.length; i += CHUNK) {
        await options.table(db).createMany({
          data: creates.slice(i, i + CHUNK).map((r) => ({
            ...options.createDefaults,
            ...toDb(Object.fromEntries(Object.entries(r.data).filter(([, v]) => v !== null))),
            createdById: actorUserId,
            updatedById: actorUserId,
          })),
        });
      }
      for (const row of rows.filter((r) => r.action === 'update')) {
        await options.table(db).update({
          where: { id: row.existing!.id! },
          data: { ...toDb(row.data), updatedById: actorUserId, rowVersion: { increment: 1 } },
        });
      }
    },
    async exportRows(db) {
      const stored = await options.table(db).findMany({ include, orderBy: options.orderBy });
      return stored.map((row) =>
        Object.fromEntries(
          options.columns.map((c): [string, CellValue] => {
            if (c.type === 'ref') {
              const related = row[c.ref!.relation] as Row | null;
              return [c.header, related ? (related[c.ref!.by] as string) : null];
            }
            const value = canonical(row[c.field]);
            if (c.type === 'json') return [c.header, value === null ? null : JSON.stringify(value)];
            return [c.header, value as CellValue];
          }),
        ),
      );
    },
  };
}

/** `where` for rows keyed by one unique column. */
export const byColumn =
  (column: string) =>
  (rows: ParsedRow[]): object => ({ [column]: { in: rows.map((r) => r.key) } });
