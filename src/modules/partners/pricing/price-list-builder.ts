import { createHash } from 'node:crypto';

import { DomainException } from '@common/errors/domain.exception';
import { type Tx } from '@database/prisma.service';
import { type PriceComponent, type ProposalLineAction } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';

import {
  columnOf,
  lineKeyOf,
  normaliseValue,
  type PriceColumn,
  type PriceComponentDescriptor,
  PriceComponentRegistry,
  type PriceFieldError,
  type PriceValues,
  rowCanon,
} from './price-component.registry';

/** A line as it goes into a version: the accepted value (counter or proposed), or a removal. */
export interface FinalLine {
  component: PriceComponent;
  action: ProposalLineAction;
  lineKey: string;
  /** Dimensions + values in API form; null for `remove`. */
  values: PriceValues | null;
}

export interface PriceRow {
  lineKey: string;
  values: PriceValues;
}

/** Postgres driver values → API form (numeric arrives as Decimal, bigint as BigInt). */
function fromDb(c: PriceColumn, raw: unknown): PriceValues[string] {
  if (raw === null || raw === undefined) return null;
  const value =
    typeof raw === 'bigint'
      ? Number(raw)
      : typeof raw === 'object'
        ? (raw as { toString(): string }).toString()
        : raw;
  const result = normaliseValue({ ...c, min: Number.MIN_SAFE_INTEGER }, value);
  return 'error' in result ? (value as PriceValues[string]) : result.value;
}

/**
 * Copy-on-write price-list versions (schema-design §3.4, A-7): a version is the complete set of its
 * component rows, built from the version it is based on plus the accepted lines. All SQL identifiers
 * come from registered descriptors, never from requests.
 */
@Injectable()
export class PriceListBuilder {
  constructor(private readonly registry: PriceComponentRegistry) {}

  /**
   * (Re)builds the rows of a `draft` or `pending_acceptance` version: clears them, copies the base
   * version's rows and applies `lines`. Returns the content digest for the version row.
   */
  async populate(
    tx: Tx,
    versionId: bigint,
    baseVersionId: bigint | null,
    lines: FinalLine[],
  ): Promise<{ lineCount: number; contentSha256: Uint8Array<ArrayBuffer> }> {
    for (const d of this.registry.all()) {
      await tx.$executeRawUnsafe(`DELETE FROM ${d.table} WHERE price_list_version_id = $1`, versionId);
      if (baseVersionId !== null) {
        const columns = ['line_key', ...[...d.dimensions, ...d.values].map(columnOf)].join(', ');
        await tx.$executeRawUnsafe(
          `INSERT INTO ${d.table} (price_list_version_id, ${columns}) ` +
            `SELECT $1, ${columns} FROM ${d.table} WHERE price_list_version_id = $2`,
          versionId,
          baseVersionId,
        );
      }
    }
    for (const line of lines) await this.apply(tx, versionId, line);
    return this.summarise(tx, versionId);
  }

  /** Rows of one component in a version, ordered by line key. */
  async rows(
    db: Tx,
    versionId: bigint,
    component: PriceComponent,
    page?: { limit: number; offset: number },
  ): Promise<{ rows: PriceRow[]; total: number }> {
    const d = this.descriptor(component);
    const limit = page ? ` LIMIT ${Math.trunc(page.limit)} OFFSET ${Math.trunc(page.offset)}` : '';
    const rows = await this.select(db, d, `t.price_list_version_id = $1 ORDER BY t.line_key${limit}`, [
      versionId,
    ]);
    const counted = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) AS count FROM ${d.table} WHERE price_list_version_id = $1`,
      versionId,
    );
    return { rows, total: Number(counted[0]?.count ?? 0) };
  }

  /** How many lines each registered component holds in a version (one query over every component table, D-406). */
  async counts(db: Tx, versionId: bigint): Promise<{ component: PriceComponent; lines: number }[]> {
    const all = this.registry.all();
    if (!all.length) return [];
    const sql = all
      .map((d, i) => `SELECT ${i} AS i, count(*) AS n FROM ${d.table} WHERE price_list_version_id = $1`)
      .join(' UNION ALL ');
    const rows = await db.$queryRawUnsafe<{ i: number; n: bigint }[]>(sql, versionId);
    const byIndex = new Map(rows.map((r) => [Number(r.i), Number(r.n)]));
    return all.map((d, i) => ({ component: d.component, lines: byIndex.get(i) ?? 0 }));
  }

  /** One row of a version by line key, or null. */
  async row(
    db: Tx,
    versionId: bigint,
    component: PriceComponent,
    lineKey: string,
  ): Promise<PriceValues | null> {
    const d = this.descriptor(component);
    const [found] = await this.select(db, d, 't.price_list_version_id = $1 AND t.line_key = $2', [
      versionId,
      lineKey,
    ]);
    return found?.values ?? null;
  }

  private async select(
    db: Tx,
    d: PriceComponentDescriptor,
    where: string,
    params: unknown[],
  ): Promise<PriceRow[]> {
    const columns = [...d.dimensions, ...d.values];
    const select = columns
      .map((c) =>
        c.type === 'ref'
          ? `(SELECT r.public_id::text FROM ${c.ref} r WHERE r.id = t.${columnOf(c)}) AS ${columnOf(c)}`
          : `t.${columnOf(c)}`,
      )
      .join(', ');
    const raw = await db.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT t.line_key, ${select} FROM ${d.table} t WHERE ${where}`,
      ...params,
    );
    return raw.map((r) => ({
      lineKey: r['line_key'] as string,
      values: Object.fromEntries(columns.map((c) => [c.key, fromDb(c, r[columnOf(c)])])),
    }));
  }

  /** Resolves the `ref` columns of normalised values to internal ids; errors name missing rows. */
  async resolveRefs(
    db: Tx,
    d: PriceComponentDescriptor,
    values: PriceValues,
    path: string,
  ): Promise<{ ids: Map<string, bigint>; errors: PriceFieldError[] }> {
    const ids = new Map<string, bigint>();
    const errors: PriceFieldError[] = [];
    for (const c of [...d.dimensions, ...d.values].filter((col) => col.type === 'ref')) {
      const publicId = values[c.key];
      if (publicId === null || publicId === undefined) continue;
      const found = await db.$queryRawUnsafe<{ id: bigint }[]>(
        `SELECT id FROM ${c.ref} WHERE public_id = $1::uuid`,
        publicId,
      );
      if (found[0]) ids.set(c.key, found[0].id);
      else errors.push({ path: `${path}.${c.key}`, code: 'exists', message: `${c.key} does not exist` });
    }
    return { ids, errors };
  }

  descriptor(component: PriceComponent): PriceComponentDescriptor {
    const d = this.registry.get(component);
    if (!d) throw new Error(`price component ${component} is not registered`);
    return d;
  }

  private async apply(tx: Tx, versionId: bigint, line: FinalLine): Promise<void> {
    const d = this.descriptor(line.component);
    if (line.action === 'remove') {
      const n = await tx.$executeRawUnsafe(
        `DELETE FROM ${d.table} WHERE price_list_version_id = $1 AND line_key = $2`,
        versionId,
        line.lineKey,
      );
      if (n !== 1)
        throw new DomainException('partners.price_line_conflict', { params: { lineKey: line.lineKey } });
      return;
    }
    const values = line.values!;
    if (lineKeyOf(d, values) !== line.lineKey) throw new Error(`line key mismatch for ${line.component}`);
    const { ids, errors } = await this.resolveRefs(tx, d, values, 'values');
    if (errors.length > 0) throw new DomainException('validation.failed', { errors });
    const param = (c: PriceColumn) => (c.type === 'ref' ? (ids.get(c.key) ?? null) : values[c.key]);
    if (line.action === 'change') {
      const set = d.values.map((c, i) => `${columnOf(c)} = $${i + 3}`).join(', ');
      const n = await tx.$executeRawUnsafe(
        `UPDATE ${d.table} SET ${set} WHERE price_list_version_id = $1 AND line_key = $2`,
        versionId,
        line.lineKey,
        ...d.values.map(param),
      );
      if (n !== 1)
        throw new DomainException('partners.price_line_conflict', { params: { lineKey: line.lineKey } });
      return;
    }
    const columns = [...d.dimensions, ...d.values];
    const exists = await tx.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM ${d.table} WHERE price_list_version_id = $1 AND line_key = $2`,
      versionId,
      line.lineKey,
    );
    if (exists.length > 0)
      throw new DomainException('partners.price_line_conflict', { params: { lineKey: line.lineKey } });
    await tx.$executeRawUnsafe(
      `INSERT INTO ${d.table} (price_list_version_id, line_key, ${columns.map(columnOf).join(', ')}) ` +
        `VALUES ($1, $2, ${columns.map((_, i) => `$${i + 3}`).join(', ')})`,
      versionId,
      line.lineKey,
      ...columns.map(param),
    );
  }

  /** Row count and SHA-256 over every component row, in (component, line key) order. */
  private async summarise(tx: Tx, versionId: bigint) {
    const hash = createHash('sha256');
    let lineCount = 0;
    for (const d of this.registry.all()) {
      const { rows } = await this.rows(tx, versionId, d.component);
      for (const r of rows) hash.update(`${d.component}|${r.lineKey}|${rowCanon(d, r.values)}\n`);
      lineCount += rows.length;
    }
    return { lineCount, contentSha256: new Uint8Array(hash.digest()) };
  }
}
