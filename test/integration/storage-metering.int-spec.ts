import { COUNTED_RECORDS } from '@modules/storage/storage-settings';

import {
  inRollback,
  type MigratedDatabase,
  SQLSTATE,
  sqlState,
  startMigratedDatabase,
  stopMigratedDatabase,
} from '../support/database';

/** Storage metering tables (D-436, migration `20261214000001_storage_metering`). */
describe('storage metering schema (PostgreSQL 18)', () => {
  let db: MigratedDatabase;

  beforeAll(async () => {
    db = await startMigratedDatabase();
  });

  afterAll(async () => {
    await stopMigratedDatabase(db);
  });

  const id = async (sql: string, params: unknown[] = []): Promise<string> => {
    const { rows } = await db.client.query<{ id: string }>(`${sql} RETURNING id`, params);
    return rows[0]!.id;
  };

  async function factory(): Promise<string> {
    const vendor = await id(
      "INSERT INTO vendors (kind, legal_name, juristic_type, tax_id) VALUES ('factory', 'โรงงานทดสอบ', 'company', '0000000099001')",
    );
    return id(
      `INSERT INTO factories (code, vendor_id, legal_name, juristic_type, tax_id)
       VALUES ('F9901', $1, 'โรงงานทดสอบ', 'company', '0000000099001')`,
      [vendor],
    );
  }

  it('counts every record type from a table that has the factory column', async () => {
    const union = Object.entries(COUNTED_RECORDS)
      .map(
        ([type, table]) =>
          `SELECT '${type}'::text AS type, count(*)::int AS n FROM "${table}" WHERE factory_id = $1`,
      )
      .join(' UNION ALL ');
    const { rows } = await db.client.query(union, [0]);
    expect(rows).toHaveLength(Object.keys(COUNTED_RECORDS).length);
  });

  it('keeps one snapshot per factory and day, rewritten when the job runs again', async () => {
    await inRollback(db.client, async () => {
      const f = await factory();
      const insert = `INSERT INTO storage_usage_daily
          (factory_id, account_type, day, file_bytes, record_counts, counted_bytes, allowance_bytes, setting_version_ids)
        VALUES ($1, 'factory', '2026-10-25', $2, '{"sales_invoice": 3}', $3, 5368709120, ARRAY['1','2','3','4','5'])
        ON CONFLICT (factory_id, day) DO UPDATE SET counted_bytes = EXCLUDED.counted_bytes`;
      await db.client.query(insert, [f, 100, 6244]);
      await db.client.query(insert, [f, 100, 7000]);
      const { rows } = await db.client.query<{ counted_bytes: string }>(
        'SELECT counted_bytes FROM storage_usage_daily WHERE factory_id = $1',
        [f],
      );
      expect(rows.map((r) => r.counted_bytes)).toEqual(['7000']);
      // Counted bytes include the files: never fewer.
      expect(
        await sqlState(
          db.client,
          `INSERT INTO storage_usage_daily (factory_id, account_type, day, file_bytes, counted_bytes)
           VALUES ($1, 'factory', '2026-10-26', 100, 50)`,
          [f],
        ),
      ).toBe(SQLSTATE.checkViolation);
    });
  });

  it('allows one open notice per threshold; a cleared one can be sent again', async () => {
    await inRollback(db.client, async () => {
      const f = await factory();
      const notice = `INSERT INTO storage_notices (factory_id, threshold_pct, crossed_on, used_bytes, allowance_bytes)
        VALUES ($1, 80, '2026-10-25', 4294967296, 5368709120)`;
      await db.client.query(notice, [f]);
      expect(await sqlState(db.client, notice, [f])).toBe(SQLSTATE.uniqueViolation);
      await db.client.query('UPDATE storage_notices SET cleared_at = now() WHERE factory_id = $1', [f]);
      await db.client.query(notice, [f]);
      const { rows } = await db.client.query('SELECT 1 FROM storage_notices WHERE factory_id = $1', [f]);
      expect(rows).toHaveLength(2);
    });
  });
});
