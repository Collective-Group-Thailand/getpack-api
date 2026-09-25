import { createHash } from 'node:crypto';

import { type Tx } from '@database/prisma.service';

import { type CellValue, type SheetRows } from './workbook';

/** Bumped whenever parsing or diffing changes, so an old preview can never be confirmed. */
export const PARSER_VERSION = 1;
/** Technical ceiling per file (not a business value): larger files are split by the user. */
export const MAX_IMPORT_ROWS = 20_000;
/** Row errors returned in a preview (the counts always cover every row). */
export const MAX_REPORTED_ERRORS = 200;

export type ColumnType = 'text' | 'int' | 'decimal' | 'bool' | 'enum' | 'json' | 'ref';

/** A table addressed by a natural key (code, slug, sku…). */
export interface KeyedTable {
  findMany(args: {
    where: Record<string, unknown>;
    select: Record<string, true>;
  }): Promise<Record<string, unknown>[]>;
}

export interface RefSpec {
  table: (db: Tx) => KeyedTable;
  /** Natural-key column of the referenced table. */
  by: string;
  /** Prisma relation name on the importing table, for export (`family` → `family.code`). */
  relation: string;
  /** An earlier sheet of the same import that may define the referenced row. */
  sheet?: string;
  /** Extra filter on the referenced table (e.g. stock attribute values of one attribute). */
  where?: Record<string, unknown>;
}

/** Internal ids by natural key, inside the import transaction. */
export async function lookupRef(db: Tx, ref: RefSpec, keys: string[]): Promise<Map<string, bigint>> {
  const rows = await ref.table(db).findMany({
    where: { ...ref.where, [ref.by]: { in: keys } },
    select: { id: true, [ref.by]: true },
  });
  return new Map(rows.map((row) => [String(row[ref.by]), row['id'] as bigint]));
}

export interface ColumnSpec {
  /** Header text in row 1 (snake_case, compared case-insensitively). */
  header: string;
  /** Field of the parsed row (Prisma scalar; for `ref` the FK column, e.g. `familyId`). */
  field: string;
  type: ColumnType;
  required?: boolean;
  values?: readonly string[];
  max?: number;
  pattern?: RegExp;
  /** Decimal places allowed (`decimal`). */
  scale?: number;
  /**
   * An empty cell clears a nullable column; for other columns it means "default on create,
   * unchanged on update" (status, flags, sort).
   */
  nullable?: boolean;
  /** `ref`: how to resolve the key. */
  ref?: RefSpec;
  description?: string;
}

export interface ParsedRow {
  rowNumber: number;
  /** Natural key, e.g. `art-card-350` or `tuck-end-box|S`. */
  key: string;
  /** Parsed values by field; refs hold the internal id, or `null` while pending (defined in this file). */
  data: Record<string, unknown>;
  /** Raw key values of `ref` columns (for pending refs and error messages). */
  refKeys: Record<string, string | null>;
}

export interface ExistingRow {
  id: bigint | null;
  values: Record<string, unknown>;
}

export type RowAction = 'create' | 'update' | 'unchanged';

export interface PlannedRow extends ParsedRow {
  action: RowAction;
  existing?: ExistingRow;
}

export interface SheetSpec {
  name: string;
  columns: ColumnSpec[];
  /** Headers that form the natural key, in order. */
  key: string[];
  /** Existing rows for the parsed keys (map key = {@link ParsedRow.key}). */
  existing: (db: Tx, rows: ParsedRow[]) => Promise<Map<string, ExistingRow>>;
  /** Writes the planned creates/updates of this sheet (unchanged rows are skipped by the engine). */
  apply: (db: Tx, rows: PlannedRow[], actorUserId: bigint) => Promise<void>;
  /** Current rows for export, keyed by header. */
  exportRows: (db: Tx) => Promise<Record<string, CellValue>[]>;
  /** Fields compared for the diff (defaults: every column field). */
  compare?: string[];
}

export interface ImportKind {
  key: string;
  label: string;
  /** Sheets in dependency order (a `ref.sheet` points at an earlier sheet). */
  sheets: SheetSpec[];
}

export interface RowError {
  sheet: string;
  row: number;
  column: string | null;
  code: string;
  message: string;
}

export interface SheetPlan {
  name: string;
  rows: PlannedRow[];
  create: number;
  update: number;
  unchanged: number;
  invalid: number;
}

export interface ImportPlan {
  sheets: SheetPlan[];
  errors: RowError[];
  /** Rows with at least one error. */
  invalid: number;
  sha256: string;
}

// ------------------------------------------------------------------------------------------------
// Cell parsing
// ------------------------------------------------------------------------------------------------

const TRUE = new Set(['true', 'yes', 'y', '1', 'ใช่']);
const FALSE = new Set(['false', 'no', 'n', '0', 'ไม่']);

function parseCell(column: ColumnSpec, raw: CellValue): { value: unknown; error?: string; code?: string } {
  if (raw === null) {
    return column.required
      ? { value: null, code: 'required', error: `${column.header} is required` }
      : { value: null };
  }
  const text = typeof raw === 'string' ? raw : String(raw);
  switch (column.type) {
    case 'text':
    case 'ref': {
      if (column.max !== undefined && text.length > column.max)
        return { value: null, code: 'max', error: `${column.header} is longer than ${column.max}` };
      if (column.pattern && !column.pattern.test(text))
        return { value: null, code: 'pattern', error: `${column.header} has an invalid format` };
      return { value: text };
    }
    case 'enum':
      return column.values?.includes(text)
        ? { value: text }
        : {
            value: null,
            code: 'enum',
            error: `${column.header} must be one of ${column.values?.join(', ')}`,
          };
    case 'int': {
      const n = Number(text);
      return Number.isInteger(n) && n >= 0 && n <= 2_147_483_647
        ? { value: n }
        : { value: null, code: 'int', error: `${column.header} must be a whole number` };
    }
    case 'decimal': {
      const n = Number(text);
      const decimals = text.includes('.') ? text.split('.')[1]!.length : 0;
      if (!Number.isFinite(n) || n < 0)
        return { value: null, code: 'decimal', error: `${column.header} must be a number ≥ 0` };
      if (column.scale !== undefined && typeof raw === 'string' && decimals > column.scale)
        return { value: null, code: 'decimal', error: `${column.header} allows ${column.scale} decimals` };
      return { value: n };
    }
    case 'bool': {
      if (typeof raw === 'boolean') return { value: raw };
      const lower = text.toLowerCase();
      if (TRUE.has(lower)) return { value: true };
      if (FALSE.has(lower)) return { value: false };
      return { value: null, code: 'bool', error: `${column.header} must be true or false` };
    }
    case 'json': {
      try {
        const parsed: unknown = JSON.parse(text);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
          return { value: null, code: 'json', error: `${column.header} must be a JSON object` };
        return { value: parsed };
      } catch {
        return { value: null, code: 'json', error: `${column.header} must be valid JSON` };
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------
// Planning (shared by preview and confirm)
// ------------------------------------------------------------------------------------------------

/** Canonical form for comparisons and hashing: decimals as numbers, bigint as strings, sorted keys. */
export function canonical(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object' && 'toNumber' in value && typeof value.toNumber === 'function') {
    return (value as { toNumber(): number }).toNumber();
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/**
 * Parses, validates and diffs a workbook against the database. Sheets are planned in order; a ref
 * to an earlier sheet of the same file is satisfied by that sheet's keys (its id is known only once
 * that sheet is written). With `write`, each valid sheet is applied before the next one is planned,
 * so pending refs resolve to real ids. The hash covers the parsed data, the planned actions and the
 * stored values each update overwrites: if the database changed between preview and confirm,
 * confirm refuses (`catalog.import_stale`).
 */
export async function planImport(
  db: Tx,
  kind: ImportKind,
  workbook: SheetRows[],
  fileSha256: string,
  write?: { actorUserId: bigint },
): Promise<ImportPlan> {
  const errors: RowError[] = [];
  const invalidRows = new Set<string>();
  const fileKeys = new Map<string, Set<string>>();
  const sheets: SheetPlan[] = [];
  const error = (e: RowError) => {
    errors.push(e);
    invalidRows.add(`${e.sheet}#${e.row}`);
  };

  for (const spec of kind.sheets) {
    const source = workbook.find((s) => s.name === spec.name);
    const plan: SheetPlan = { name: spec.name, rows: [], create: 0, update: 0, unchanged: 0, invalid: 0 };
    sheets.push(plan);
    if (!source) {
      if (spec.columns.some((c) => c.required)) {
        error({
          sheet: spec.name,
          row: 1,
          column: null,
          code: 'sheet',
          message: `sheet "${spec.name}" is missing`,
        });
      }
      fileKeys.set(spec.name, new Set());
      continue;
    }
    for (const column of spec.columns.filter((c) => c.required)) {
      if (!source.headers.includes(column.header)) {
        error({
          sheet: spec.name,
          row: 1,
          column: column.header,
          code: 'header',
          message: `column "${column.header}" is missing`,
        });
      }
    }

    // 1. Parse cells.
    const parsed: (ParsedRow & { bad: boolean })[] = [];
    for (const { rowNumber, cells } of source.rows) {
      const row: ParsedRow & { bad: boolean } = { rowNumber, key: '', data: {}, refKeys: {}, bad: false };
      for (const column of spec.columns) {
        const { value, code, error: message } = parseCell(column, cells[column.header] ?? null);
        if (code) {
          row.bad = true;
          error({ sheet: spec.name, row: rowNumber, column: column.header, code, message: message! });
          continue;
        }
        if (column.type === 'ref') row.refKeys[column.field] = (value as string | null) ?? null;
        else row.data[column.field] = value;
      }
      row.key = spec.key.map((header) => String(cells[header] ?? '')).join('|');
      parsed.push(row);
    }

    // 2. Duplicate keys in the file.
    const seen = new Map<string, number>();
    for (const row of parsed) {
      const first = seen.get(row.key);
      if (first !== undefined) {
        row.bad = true;
        error({
          sheet: spec.name,
          row: row.rowNumber,
          column: spec.key.join('+'),
          code: 'duplicate',
          message: `same key as row ${first}`,
        });
      } else seen.set(row.key, row.rowNumber);
    }
    fileKeys.set(spec.name, new Set(parsed.filter((r) => !r.bad).map((r) => r.key)));

    // 3. Resolve refs (database, then earlier sheets of this file).
    for (const column of spec.columns.filter((c) => c.type === 'ref')) {
      const keys = [...new Set(parsed.map((r) => r.refKeys[column.field]).filter((k): k is string => !!k))];
      const found = keys.length ? await lookupRef(db, column.ref!, keys) : new Map<string, bigint>();
      const inFile = column.ref!.sheet ? fileKeys.get(column.ref!.sheet) : undefined;
      for (const row of parsed) {
        const key = row.refKeys[column.field];
        if (!key) {
          row.data[column.field] = null;
          continue;
        }
        const id = found.get(key);
        if (id !== undefined) row.data[column.field] = id;
        else if (inFile?.has(key))
          row.data[column.field] = null; // pending: created earlier in this file
        else {
          row.bad = true;
          error({
            sheet: spec.name,
            row: row.rowNumber,
            column: column.header,
            code: 'ref',
            message: `${column.header} "${key}" does not exist`,
          });
        }
      }
    }

    // 4. Diff with the database.
    const good = parsed.filter((r) => !r.bad);
    const existing = await spec.existing(db, good);
    const fields = spec.compare ?? spec.columns.map((c) => c.field);
    const keepOnEmpty = new Set(spec.columns.filter((c) => !c.nullable && !c.required).map((c) => c.field));
    for (const row of good) {
      for (const field of keepOnEmpty) if (row.data[field] === null) delete row.data[field];
      const current = existing.get(row.key);
      const pending = Object.entries(row.refKeys).some(
        ([field, key]) => key !== null && row.data[field] === null,
      );
      let action: RowAction = 'create';
      if (current) {
        action =
          !pending && fields.every((f) => !(f in row.data) || same(row.data[f], current.values[f]))
            ? 'unchanged'
            : 'update';
      }
      plan.rows.push({
        rowNumber: row.rowNumber,
        key: row.key,
        data: row.data,
        refKeys: row.refKeys,
        action,
        existing: current,
      });
      plan[action] += 1;
    }
    plan.invalid = parsed.length - good.length;

    // 5. Write before the next sheet is planned (confirm only, and only when nothing is invalid so far).
    if (write && invalidRows.size === 0) {
      await spec.apply(
        db,
        plan.rows.filter((r) => r.action !== 'unchanged'),
        write.actorUserId,
      );
    }
  }

  const digest = createHash('sha256').update(
    JSON.stringify(
      canonical({
        kind: kind.key,
        parser: PARSER_VERSION,
        file: fileSha256,
        sheets: sheets.map((s) => ({
          name: s.name,
          rows: s.rows.map((r) => ({
            key: r.key,
            action: r.action,
            refs: r.refKeys,
            data: withoutPendingIds(r),
            // What an update overwrites: a concurrent edit of the row makes the preview stale.
            before: r.action === 'update' ? r.existing?.values : undefined,
          })),
        })),
        invalid: [...invalidRows].sort(),
      }),
    ),
  );
  return { sheets, errors, invalid: invalidRows.size, sha256: digest.digest('hex') };
}

/**
 * Ref ids of rows created earlier in the same file differ between preview (pending, `null`) and
 * confirm (real ids): the hash uses the ref keys for them instead.
 */
function withoutPendingIds(row: PlannedRow): Record<string, unknown> {
  const data = { ...row.data };
  for (const field of Object.keys(row.refKeys)) delete data[field];
  return data;
}
