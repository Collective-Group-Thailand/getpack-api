import { columnOf } from '@modules/partners/pricing/price-component.registry';
import {
  PL_B_ASSEMBLY_PRICES,
  PL_B_PRINT_PRICES,
  PL_B_PRINT_WASTES,
  PL_CODE_MARGINS,
  PL_FOIL_PRICES,
} from '@modules/pricing/calculators/folding/price-components';

import {
  inRollback,
  type MigratedDatabase,
  SQLSTATE,
  sqlState,
  startMigratedDatabase,
  stopMigratedDatabase,
} from '../support/database';

const B_COMPONENTS = [
  PL_B_PRINT_WASTES,
  PL_B_PRINT_PRICES,
  PL_FOIL_PRICES,
  PL_B_ASSEMBLY_PRICES,
  PL_CODE_MARGINS,
];

/** Database-level rules of the folding engine B price components (U-B6 tail, schema-design A-76, D-233). */
describe('folding engine B pricing schema behaviour (PostgreSQL 18)', () => {
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
  async function fixture(): Promise<{ version: string; pt: string; level: string }> {
    const n = ++seq;
    const nn = String(n).padStart(4, '0');
    const category = await id(
      "INSERT INTO product_categories (code, name_th, name_en) VALUES ($1, 'หมวดทดสอบ', 'Test category')",
      [`bcat_${n}`],
    );
    const type = await id(
      "INSERT INTO product_types (code, category_id, name_th, name_en) VALUES ($1, $2, 'กล่องพับ', 'Folding')",
      [`btype_${n}`, category],
    );
    const pt = await id(
      "INSERT INTO print_types (code, product_type_id, name_th, name_en) VALUES ($1, $2, 'ออฟเซ็ต B', 'Offset B')",
      [`bpt_${n}`, type],
    );
    const level = await id(
      "INSERT INTO difficulty_levels (code, name_th, name_en) VALUES ($1, 'ปกติ', 'Normal')",
      [`blv_${n}`],
    );
    const vendor = await id(
      "INSERT INTO vendors (kind, legal_name, juristic_type, tax_id) VALUES ('factory', 'โรงงานทดสอบ', 'company', $1)",
      [`000000001${nn}`],
    );
    const factory = await id(
      `INSERT INTO factories (code, vendor_id, legal_name, juristic_type, tax_id)
       VALUES ($1, $2, 'โรงงานทดสอบ', 'company', $3)`,
      [`FB${nn}`, vendor, `000000001${nn}`],
    );
    const list = await id('INSERT INTO price_lists (factory_id, product_type_id) VALUES ($1, $2)', [
      factory,
      type,
    ]);
    const version = await id(
      `INSERT INTO price_list_versions (price_list_id, version_no, origin, effective_from, reason)
       VALUES ($1, 1, 'factory_proposal', now(), 'v1')`,
      [list],
    );
    return { version, pt, level };
  }

  it('declares every registered descriptor column in its table, with the same nullability', async () => {
    for (const d of B_COMPONENTS) {
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

  it('requires the rate of the assembly type', () =>
    inRollback(db.client, async () => {
      const { version, pt, level } = await fixture();
      const assembly = await id(
        "INSERT INTO assemblies (code, name_th, name_en) VALUES ($1, 'ติดกาว', 'Glue')",
        [`bglue_${seq}`],
      );
      const line = (key: string, type: number, perDepth: number | null, perPcs: number | null) =>
        sqlState(
          db.client,
          `INSERT INTO pl_b_assembly_prices (price_list_version_id, line_key, difficulty_level_id, print_type_id,
             assembly_id, assembly_type, price_per_depth_m, price_per_pcs)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [version, key, level, pt, assembly, type, perDepth, perPcs],
        );
      expect(await line('a1', 1, null, 0.5)).toBe(SQLSTATE.checkViolation);
      expect(await line('a1', 5, 1, null)).toBe(SQLSTATE.checkViolation);
      expect(await line('a1', 1, 2.5, null)).toBeNull();
      expect(await line('a2', 3, null, 0.5)).toBeNull();
    }));

  it('refuses a zero foil roll and an inverted block band', () =>
    inRollback(db.client, async () => {
      const { version, pt, level } = await fixture();
      const foil = await id(
        "INSERT INTO finishes (code, name_th, name_en, finish_kind) VALUES ($1, 'ฟอยล์', 'Foil', 'foil')",
        [`bfoil_${seq}`],
      );
      const line = (key: string, rollW: number, blockWMax: number) =>
        sqlState(
          db.client,
          `INSERT INTO pl_foil_prices (price_list_version_id, line_key, difficulty_level_id, print_type_id, finish_id,
             price_by_area_per_in2, baht_per_roll, roll_width_in, roll_length_in,
             block_w_min_in, block_w_max_in, block_l_min_in, block_l_max_in)
           VALUES ($1, $2, $3, $4, $5, 0.01, 1500, $6, 4724, 5, $7, 5, 40)`,
          [version, key, level, pt, foil, rollW, blockWMax],
        );
      expect(await line('f1', 0, 30)).toBe(SQLSTATE.checkViolation);
      expect(await line('f1', 25, 4)).toBe(SQLSTATE.checkViolation);
      expect(await line('f1', 25, 30)).toBeNull();
    }));

  it('bounds the contribution range and freezes the line with the version', () =>
    inRollback(db.client, async () => {
      const { version, pt } = await fixture();
      const line = (key: string, pct: number) =>
        sqlState(
          db.client,
          `INSERT INTO pl_code_margins (price_list_version_id, line_key, print_type_id, max_range_cont_pct,
             min_cont_baht_per_lot)
           VALUES ($1, $2, $3, $4, 500)`,
          [version, key, pt, pct],
        );
      expect(await line('c1', 0)).toBe(SQLSTATE.checkViolation);
      expect(await line('c1', 101)).toBe(SQLSTATE.checkViolation);
      expect(await line('c1', 30)).toBeNull();
      await db.client.query(
        "UPDATE price_list_versions SET status = 'approved', decided_at = now() WHERE id = $1",
        [version],
      );
      expect(
        await sqlState(
          db.client,
          'UPDATE pl_code_margins SET min_cont_baht_per_lot = 400 WHERE price_list_version_id = $1',
          [version],
        ),
      ).toBe(SQLSTATE.restrictViolation);
    }));
});
