import { type MigratedDatabase, startMigratedDatabase, stopMigratedDatabase } from '../support/database';

/**
 * B6.3 database index review (docs/launch/PERFORMANCE.md §3). Every foreign key has an index led by its columns —
 * except the audit-actor columns (`created_by`, `decided_by`, … → `users`: users are anonymised, never deleted or
 * re-keyed, and nobody queries "everything a user created" on these tables) and the actor / entity columns of the
 * partitioned audit and activity logs (append-only, queried by time). A new foreign key outside these rules needs its
 * index. The analytics schema keeps no foreign key into `public` (schema-design A-47).
 */
const ACTOR_COLUMN = /^([a-z_]+_)?(by|created_by|updated_by|decided_by)$/;
const LOG_TABLES = new Set(['audit_logs', 'activity_logs']);

describe('index review (B6.3)', () => {
  let db: MigratedDatabase;

  beforeAll(async () => {
    db = await startMigratedDatabase();
  });

  afterAll(async () => {
    await stopMigratedDatabase(db);
  });

  it('indexes every foreign key except audit-actor columns and the partitioned logs', async () => {
    const { rows } = await db.client.query<{ tbl: string; conname: string; cols: string[]; target: string }>(`
      SELECT c.conrelid::regclass::text AS tbl, c.conname, c.confrelid::regclass::text AS target,
             array(SELECT a.attname::text FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k) AS cols
      FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE c.contype = 'f' AND n.nspname = 'public'
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = c.conrelid
            AND (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
            AND (i.indkey::int2[])[0:cardinality(c.conkey) - 1] <@ c.conkey
        )`);
    const missing = rows.filter(
      (r) =>
        !(
          LOG_TABLES.has(r.tbl) ||
          (r.target === 'users' && r.cols.length === 1 && ACTOR_COLUMN.test(r.cols[0]!))
        ),
    );
    expect(missing.map((r) => `${r.tbl}.${r.cols.join(',')} (${r.conname})`)).toEqual([]);
  });

  it('keeps the analytics schema free of foreign keys into public', async () => {
    const { rows } = await db.client.query(`
      SELECT c.conname FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace JOIN pg_class t ON t.oid = c.confrelid JOIN pg_namespace tn ON tn.oid = t.relnamespace
      WHERE c.contype = 'f' AND n.nspname = 'analytics' AND tn.nspname <> 'analytics'`);
    expect(rows).toEqual([]);
  });

  it('has the time-range indexes the rollups, reports and prospectus filter on', async () => {
    const { rows } = await db.client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const names = new Set(rows.map((r) => r.indexname));
    for (const name of [
      'ix_order_groups__placed_at',
      'ix_quotes__created_at',
      'ix_quotes__converted_at',
      'ix_payments__paid_at',
      'ix_rfqs__submitted_at',
      'ix_rfqs__closed_at',
      'ix_claims__submitted_at',
      'ix_promotion_redemptions__applied_at',
      'ix_unmet_demand_records__occurred_at',
      'ix_shipments__picked_up_at',
      'ix_shipments__delivered_at',
      'ix_production_jobs__released_at',
      'ix_orders__shipped_at',
      'ix_payout_runs__pay_on',
    ])
      expect(names.has(name)).toBe(true);
  });
});
