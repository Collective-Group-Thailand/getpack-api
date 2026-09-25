import { createHash } from 'node:crypto';

import { type Tx } from '@database/prisma.service';
import { type PriceComponent } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';

/** D-040 suggestion groups (schema-design §3.4); `rules` lines get no suggestion. */
export type PriceGroup = 'materials' | 'process_rates' | 'waste' | 'commercial_terms' | 'shipping' | 'rules';

/**
 * A column of a `pl_*` table. `ref` columns hold the internal id of a catalogue row and travel as its
 * public id (uuid) in the API, proposals and line keys, so keys stay stable across environments.
 */
export interface PriceColumn {
  /** API name (camelCase); the SQL column defaults to its snake_case form. */
  key: string;
  column?: string;
  type: 'decimal' | 'integer' | 'ref' | 'text' | 'boolean';
  nullable?: boolean;
  /** decimal: digits kept after the point (default 6, the `numeric(18,6)` rate scale). */
  scale?: number;
  /** decimal / integer: inclusive lower bound (default 0 — buy prices are never negative). */
  min?: number;
  /** ref: catalogue table holding `id` and `public_id`. */
  ref?: string;
}

export type PriceValue = string | number | boolean | null;
export type PriceValues = Record<string, PriceValue>;
export interface PriceFieldError {
  path: string;
  code: string;
  message: string;
}

/**
 * One `pl_*` component table, registered by the calculator port that owns it (B2.3). The registry
 * is what proposals, copy-on-write versions, suggestions and simulations work over (A-13).
 */
export interface PriceComponentDescriptor {
  component: PriceComponent;
  /** SQL table (`pl_*`). Every row has `price_list_version_id` and `line_key` besides its columns. */
  table: string;
  group: PriceGroup;
  /** Columns that identify a line; their canonical hash is the `line_key`. */
  dimensions: PriceColumn[];
  /** Columns a proposal changes. */
  values: PriceColumn[];
  /** Extra rules beyond column types (bands, cross-field checks); paths relative to `values`. */
  validate?(values: PriceValues): PriceFieldError[];
  /**
   * Group 2: code of the cost-driver index series (minimum wage, electricity Ft, PPI) that moves this
   * component's rates; without it the own-history suggestion is `driver_not_configured` (D-040).
   */
  costDriverSeries?: string;
  /** Group 1: material family the line prices, for the index-linked suggestion (D-040). */
  materialFamilyOf?(values: PriceValues, db: Tx): Promise<bigint | null>;
  /** Tier B: whether this component's lines cover a configuration (D-043), used by quote-path. */
  coversConfiguration?(
    versionId: bigint,
    configuration: Record<string, unknown>,
    db: Tx,
  ): Promise<boolean | undefined>;
}

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const columnOf = (c: PriceColumn): string =>
  c.column ?? c.key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

/** Canonical string of a normalised value (hashes and diffs). */
const canon = (v: PriceValue): string => (v === null ? '∅' : String(v));

/**
 * Normalises one value to its API form: decimals as fixed-scale strings, integers as numbers, refs as
 * lower-case uuids. Returns an error message when the value does not fit the column.
 */
export function normaliseValue(c: PriceColumn, raw: unknown): { value: PriceValue } | { error: string } {
  if (raw === null || raw === undefined) {
    return c.nullable ? { value: null } : { error: `${c.key} is required` };
  }
  switch (c.type) {
    case 'decimal': {
      if (typeof raw !== 'string' && typeof raw !== 'number') return { error: `${c.key} must be a decimal` };
      let d: Decimal;
      try {
        d = new Decimal(raw);
      } catch {
        return { error: `${c.key} must be a decimal` };
      }
      if (!d.isFinite()) return { error: `${c.key} must be a decimal` };
      if (d.lt(c.min ?? 0)) return { error: `${c.key} must be at least ${c.min ?? 0}` };
      const scale = c.scale ?? 6;
      if (d.decimalPlaces() > scale) return { error: `${c.key} allows at most ${scale} decimal places` };
      return { value: d.toFixed(scale) };
    }
    case 'integer': {
      const n = typeof raw === 'string' && /^-?\d+$/.test(raw) ? Number(raw) : raw;
      if (typeof n !== 'number' || !Number.isSafeInteger(n)) return { error: `${c.key} must be an integer` };
      if (n < (c.min ?? 0)) return { error: `${c.key} must be at least ${c.min ?? 0}` };
      return { value: n };
    }
    case 'ref':
      if (typeof raw !== 'string' || !UUID.test(raw)) return { error: `${c.key} must be a uuid` };
      return { value: raw.toLowerCase() };
    case 'text':
      if (typeof raw !== 'string' || raw.trim() === '' || raw.length > 500) {
        return { error: `${c.key} must be a non-empty text of at most 500 characters` };
      }
      return { value: raw };
    case 'boolean':
      if (typeof raw !== 'boolean') return { error: `${c.key} must be true or false` };
      return { value: raw };
  }
}

/** Registry of the `pl_*` components the running build knows (empty until B2.3 ports a calculator). */
@Injectable()
export class PriceComponentRegistry {
  private readonly components = new Map<PriceComponent, PriceComponentDescriptor>();

  register(descriptor: PriceComponentDescriptor): void {
    if (this.components.has(descriptor.component)) {
      throw new Error(`price component ${descriptor.component} registered twice`);
    }
    // Table and column names are interpolated into SQL: code-defined identifiers only.
    const names = [descriptor.table, ...[...descriptor.dimensions, ...descriptor.values].map(columnOf)];
    for (const name of names) {
      if (!IDENTIFIER.test(name))
        throw new Error(`invalid SQL identifier ${name} in ${descriptor.component}`);
    }
    for (const ref of [...descriptor.dimensions, ...descriptor.values].filter((c) => c.type === 'ref')) {
      if (!ref.ref || !IDENTIFIER.test(ref.ref)) throw new Error(`ref column ${ref.key} needs a table`);
    }
    if (!descriptor.table.startsWith('pl_'))
      throw new Error(`component table ${descriptor.table} must be pl_*`);
    this.components.set(descriptor.component, descriptor);
  }

  /** For tests: forget a component registered by the test. */
  unregister(component: PriceComponent): void {
    this.components.delete(component);
  }

  get(component: PriceComponent): PriceComponentDescriptor | undefined {
    return this.components.get(component);
  }

  all(): PriceComponentDescriptor[] {
    return [...this.components.values()].sort((a, b) => a.component.localeCompare(b.component));
  }
}

/** Stable line identity: SHA-256 (hex) over the canonical dimension values, in declaration order. */
export function lineKeyOf(descriptor: PriceComponentDescriptor, dimensions: PriceValues): string {
  const text = descriptor.dimensions.map((c) => `${c.key}=${canon(dimensions[c.key] ?? null)}`).join('\n');
  return createHash('sha256').update(text).digest('hex');
}

/** Canonical text of a whole row, for the version content digest. */
export function rowCanon(descriptor: PriceComponentDescriptor, row: PriceValues): string {
  return [...descriptor.dimensions, ...descriptor.values].map((c) => canon(row[c.key] ?? null)).join('|');
}

/**
 * Validates and normalises `input` against `columns` (unknown keys refused). `path` prefixes error
 * paths, e.g. `lines[2].values`.
 */
export function normaliseColumns(
  columns: PriceColumn[],
  input: Record<string, unknown>,
  path: string,
): { values: PriceValues; errors: PriceFieldError[] } {
  const errors: PriceFieldError[] = [];
  const values: PriceValues = {};
  const known = new Set(columns.map((c) => c.key));
  for (const key of Object.keys(input)) {
    if (!known.has(key))
      errors.push({ path: `${path}.${key}`, code: 'unknown', message: `${key} is not a column` });
  }
  for (const c of columns) {
    const result = normaliseValue(c, input[c.key]);
    if ('error' in result) errors.push({ path: `${path}.${c.key}`, code: 'invalid', message: result.error });
    else values[c.key] = result.value;
  }
  return { values, errors };
}
