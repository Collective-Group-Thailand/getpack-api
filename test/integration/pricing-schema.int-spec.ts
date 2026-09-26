import {
  inRollback,
  type MigratedDatabase,
  SQLSTATE,
  sqlState,
  startMigratedDatabase,
  stopMigratedDatabase,
} from '../support/database';

/** Database-level rules of the shared B2.3 pricing tables (schema-design §3.5, §3.8, D-063). */
describe('pricing schema behaviour (PostgreSQL 18)', () => {
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

  let seq = 0;
  async function productType(): Promise<string> {
    const n = ++seq;
    const category = await id(
      "INSERT INTO product_categories (code, name_th, name_en) VALUES ($1, 'หมวดทดสอบ', 'Test category')",
      [`cat_${n}`],
    );
    return id(
      "INSERT INTO product_types (code, category_id, name_th, name_en) VALUES ($1, $2, 'ประเภททดสอบ', 'Test type')",
      [`type_${n}`, category],
    );
  }
  const printType = (productTypeId: string) =>
    id(
      "INSERT INTO print_types (code, product_type_id, name_th, name_en) VALUES ($1, $2, 'พิมพ์', 'Print')",
      [`print_${++seq}`, productTypeId],
    );
  const table = (productTypeId: string, printTypeId: string | null = null, kind = 'margin') =>
    id(
      `INSERT INTO sell_margin_tables (product_type_id, print_type_id, kind, description, decision_refs)
       VALUES ($1, $2, $3::sell_margin_kind, 'Test margins', ARRAY['D-063'])`,
      [productTypeId, printTypeId, kind],
    );
  const version = (tableId: string, versionNo = 1) =>
    id(
      "INSERT INTO sell_margin_table_versions (table_id, version_no, effective_from, reason) VALUES ($1, $2, now(), 'test')",
      [tableId, versionNo],
    );
  const line = (versionId: string, values: Record<string, number | null>) => {
    const columns = Object.keys(values);
    const placeholders = columns.map((_, i) => `$${i + 2}`).join(', ');
    return sqlState(
      db.client,
      `INSERT INTO sell_margin_lines (version_id, ${columns.join(', ')}) VALUES ($1, ${placeholders})`,
      [versionId, ...Object.values(values)],
    );
  };

  it('keeps one table per product type, print type and kind; print types must belong to the type', () =>
    inRollback(db.client, async () => {
      const type = await productType();
      const other = await productType();
      const print = await printType(type);
      await table(type);
      await table(type, print);
      expect(
        await sqlState(
          db.client,
          "INSERT INTO sell_margin_tables (product_type_id, kind, description, decision_refs) VALUES ($1, 'margin', 'x', ARRAY['D-063'])",
          [type],
        ),
      ).toBe(SQLSTATE.uniqueViolation);
      expect(
        await sqlState(
          db.client,
          "INSERT INTO sell_margin_tables (product_type_id, print_type_id, kind, description, decision_refs) VALUES ($1, $2, 'fix_cost', 'x', ARRAY['D-063'])",
          [other, print],
        ),
      ).toBe(SQLSTATE.checkViolation);
    }));

  it('refuses overlapping bands: quantities inclusive, prices half-open', () =>
    inRollback(db.client, async () => {
      const v = await version(await table(await productType()));
      expect(
        await line(v, { qty_min: 1, qty_max: 999, price_min: 0, price_max: 1000, value_pct: 3 }),
      ).toBeNull();
      // Same quantity band, next price band: 1000 is excluded from [0, 1000).
      expect(
        await line(v, { qty_min: 1, qty_max: 999, price_min: 1000, price_max: null, value_pct: 2 }),
      ).toBeNull();
      // Quantity 999 is inside [1, 999]: overlap.
      expect(await line(v, { qty_min: 999, qty_max: 5000, price_min: 0, price_max: 10, value_pct: 1 })).toBe(
        SQLSTATE.exclusionViolation,
      );
      expect(
        await line(v, { qty_min: 1000, qty_max: 5000, price_min: 0, price_max: 10, value_pct: 1 }),
      ).toBeNull();
    }));

  it('checks band order and exactly one value, and refuses a 100 % margin', () =>
    inRollback(db.client, async () => {
      const v = await version(await table(await productType()));
      expect(await line(v, { qty_min: 10, qty_max: 5, value_pct: 3 })).toBe(SQLSTATE.checkViolation);
      expect(await line(v, { price_min: 10, price_max: 10, value_pct: 3 })).toBe(SQLSTATE.checkViolation);
      expect(await line(v, { value_pct: 3, value_amount: 100 })).toBe(SQLSTATE.checkViolation);
      expect(await line(v, { qty_min: 1, value_pct: 100 })).toBe(SQLSTATE.checkViolation);
      expect(await line(v, { qty_min: 1, value_amount: 2500 })).toBeNull();
    }));

  it('freezes lines and versions once the version is decided', () =>
    inRollback(db.client, async () => {
      const v = await version(await table(await productType()));
      expect(await line(v, { qty_min: 1, value_pct: 3 })).toBeNull();
      await db.client.query(
        "UPDATE sell_margin_table_versions SET status = 'approved', decided_at = now() WHERE id = $1",
        [v],
      );
      expect(await line(v, { qty_min: 5000, value_pct: 2 })).toBe(SQLSTATE.restrictViolation);
      expect(
        await sqlState(db.client, 'UPDATE sell_margin_lines SET value_pct = 4 WHERE version_id = $1', [v]),
      ).toBe(SQLSTATE.restrictViolation);
      expect(await sqlState(db.client, 'DELETE FROM sell_margin_lines WHERE version_id = $1', [v])).toBe(
        SQLSTATE.restrictViolation,
      );
      expect(
        await sqlState(db.client, "UPDATE sell_margin_table_versions SET reason = 'edited' WHERE id = $1", [
          v,
        ]),
      ).toBe(SQLSTATE.restrictViolation);
    }));

  it('keeps tax-rate versions dated and immutable once approved (accounting-design §2)', () =>
    inRollback(db.client, async () => {
      const rate = await id(
        "INSERT INTO tax_rates (code, name_th, name_en, description, decision_refs) VALUES ('vat_test', 'ภาษี', 'Tax', 'Test', ARRAY['D-033'])",
      );
      expect(
        await sqlState(
          db.client,
          "INSERT INTO tax_rate_versions (tax_rate_id, version_no, effective_from, rate_pct, reason) VALUES ($1, 1, now(), 101, 'x')",
          [rate],
        ),
      ).toBe(SQLSTATE.checkViolation);
      const v = await id(
        `INSERT INTO tax_rate_versions (tax_rate_id, version_no, effective_from, status, rate_pct, reason, decided_at)
         VALUES ($1, 1, now(), 'approved', 7, 'statutory', now())`,
        [rate],
      );
      expect(await sqlState(db.client, 'UPDATE tax_rate_versions SET rate_pct = 10 WHERE id = $1', [v])).toBe(
        SQLSTATE.restrictViolation,
      );
    }));

  it('writes calculate logs into monthly partitions and checks quantities', () =>
    inRollback(db.client, async () => {
      const type = await productType();
      const insert = (quantities: string) =>
        sqlState(
          db.client,
          `INSERT INTO calculate_logs (channel, product_type_id, quantities, input, input_schema_version, result_summary,
             instant_path, routed_to_rfq, duration_ms, occurred_at)
           VALUES ('web', $1, ${quantities}, '{}', 1, '{}', true, false, 12, TIMESTAMPTZ '2026-10-05 10:00+07')`,
          [type],
        );
      expect(await insert("'{500,1000}'")).toBeNull();
      expect(await insert("'{0}'")).toBe(SQLSTATE.checkViolation);
      expect(await insert("'{}'")).toBe(SQLSTATE.checkViolation);
      const { rows } = await db.client.query<{ partition: string }>(
        'SELECT tableoid::regclass::text AS partition FROM calculate_logs WHERE product_type_id = $1',
        [type],
      );
      expect(rows.map((r) => r.partition)).toEqual(['partitions.calculate_logs_2026_10']);
    }));
});
