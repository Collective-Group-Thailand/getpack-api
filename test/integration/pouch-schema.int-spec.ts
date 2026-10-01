import { columnOf } from '@modules/partners/pricing/price-component.registry';
import { POUCH_PRICE_COMPONENTS } from '@modules/pricing/calculators/pouch/price-components';

import {
  inRollback,
  type MigratedDatabase,
  SQLSTATE,
  sqlState,
  startMigratedDatabase,
  stopMigratedDatabase,
} from '../support/database';

/** Database-level rules of the pouch shape and price components (U-B6 pouch, schema-design A-73). */
describe('pouch pricing schema behaviour (PostgreSQL 18)', () => {
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
  const printType = (type: string) =>
    id(
      "INSERT INTO print_types (code, product_type_id, name_th, name_en) VALUES ($1, $2, 'ดิจิทัล', 'Digital')",
      [`pouch_digital_${++seq}`, type],
    );

  async function draftVersion(type: string): Promise<string> {
    const n = String(++seq).padStart(4, '0');
    const vendor = await id(
      "INSERT INTO vendors (kind, legal_name, juristic_type, tax_id) VALUES ('factory', 'โรงงานทดสอบ', 'company', $1)",
      [`000000000${n}`],
    );
    const factory = await id(
      `INSERT INTO factories (code, vendor_id, legal_name, juristic_type, tax_id)
       VALUES ($1, $2, 'โรงงานทดสอบ', 'company', $3)`,
      [`F${n}`, vendor, `000000000${n}`],
    );
    const list = await id('INSERT INTO price_lists (factory_id, product_type_id) VALUES ($1, $2)', [
      factory,
      type,
    ]);
    return id(
      `INSERT INTO price_list_versions (price_list_id, version_no, origin, effective_from, reason)
       VALUES ($1, 1, 'factory_proposal', now(), 'v1')`,
      [list],
    );
  }

  it('declares every registered descriptor column in its table, with the same nullability', async () => {
    for (const d of POUCH_PRICE_COMPONENTS) {
      const { rows } = await db.client.query<{ column_name: string; is_nullable: 'YES' | 'NO' }>(
        'SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = $1',
        [d.table],
      );
      const columns = new Map(rows.map((r) => [r.column_name, r.is_nullable === 'YES']));
      expect(columns.has('price_list_version_id') && columns.has('line_key')).toBe(true);
      for (const c of [...d.dimensions, ...d.values]) {
        expect({ table: d.table, column: columnOf(c), nullable: columns.get(columnOf(c)) }).toEqual({
          table: d.table,
          column: columnOf(c),
          nullable: c.nullable === true,
        });
      }
      const known = new Set([
        'id',
        'price_list_version_id',
        'line_key',
        'created_at',
        ...[...d.dimensions, ...d.values].map(columnOf),
      ]);
      expect([...columns.keys()].filter((c) => !known.has(c))).toEqual([]);
    }
  });

  it('checks pouch terms and freezes them with the price-list version', () =>
    inRollback(db.client, async () => {
      const type = await productType();
      const pt = await printType(type);
      const version = await draftVersion(type);
      const terms = (key: string, minDl: number, maxDl: number, marginPct: number) =>
        sqlState(
          db.client,
          `INSERT INTO pl_pouch_print_type_terms (price_list_version_id, line_key, print_type_id, tolerance_mm, min_dl_mm,
             max_dl_mm, min_material_length_m, setup_length_m, web_width_mm, min_material_cost, bridge_mm,
             factory_margin_pct, lamination_rate_per_m2, lamination_web_width_m, making_qty_threshold,
             making_price_per_pcs)
           VALUES ($1, $2, $3, 30, $4, $5, 300, 150, 800, 3500, 4, $6, 4, 0.8, 10000, 0.2)`,
          [version, key, pt, minDl, maxDl, marginPct],
        );
      expect(await terms('k1', 900, 800, 10)).toBe(SQLSTATE.checkViolation);
      expect(await terms('k1', 400, 800, 100)).toBe(SQLSTATE.checkViolation);
      expect(await terms('k1', 400, 800, 20)).toBeNull();
      await db.client.query(
        "UPDATE price_list_versions SET status = 'approved', decided_at = now() WHERE id = $1",
        [version],
      );
      expect(
        await sqlState(
          db.client,
          'UPDATE pl_pouch_print_type_terms SET factory_margin_pct = 11 WHERE price_list_version_id = $1',
          [version],
        ),
      ).toBe(SQLSTATE.restrictViolation);
    }));

  it('checks option price modes and process names', () =>
    inRollback(db.client, async () => {
      const type = await productType();
      const pt = await printType(type);
      const version = await draftVersion(type);
      const assembly = await id(
        "INSERT INTO assemblies (code, name_th, name_en) VALUES ($1, 'ซิป', 'Zipper')",
        [`zip_${++seq}`],
      );
      const option = (key: string, mode: string, perPcs: number | null, perCm2: number | null) =>
        sqlState(
          db.client,
          `INSERT INTO pl_pouch_option_prices (price_list_version_id, line_key, print_type_id, assembly_id, price_mode,
             price_per_pcs, price_per_cm2) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [version, key, pt, assembly, mode, perPcs, perCm2],
        );
      expect(await option('o1', 'per_metre', 1, null)).toBe(SQLSTATE.checkViolation);
      expect(await option('o1', 'per_cm2', 1, null)).toBe(SQLSTATE.checkViolation);
      expect(await option('o1', 'per_piece', null, null)).toBe(SQLSTATE.checkViolation);
      expect(await option('o1', 'zipper', null, null)).toBeNull();
      const process = (key: string, name: string) =>
        sqlState(
          db.client,
          `INSERT INTO pl_pouch_process_prices (price_list_version_id, line_key, print_type_id, process, min_price)
           VALUES ($1, $2, $3, $4, 3000)`,
          [version, key, pt, name],
        );
      expect(await process('p1', 'printing')).toBe(SQLSTATE.checkViolation);
      expect(await process('p1', 'lamination')).toBeNull();
    }));

  it('keeps a pouch shape off folding and corrugate patterns', () =>
    inRollback(db.client, async () => {
      const type = await productType();
      const pattern = (code: string, geometry: string | null) =>
        sqlState(
          db.client,
          `INSERT INTO patterns (product_type_id, code, name, geometry_formula, pouch_formula)
           VALUES ($1, $2, 'ซอง', $3::geometry_formula, 'stand_up')`,
          [type, code, geometry],
        );
      expect(await pattern(`P-${++seq}`, 'flat')).toBe(SQLSTATE.checkViolation);
      expect(await pattern(`P-${++seq}`, null)).toBeNull();
    }));
});
