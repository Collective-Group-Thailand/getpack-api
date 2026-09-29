import { columnOf } from '@modules/partners/pricing/price-component.registry';
import { CORRUGATE_PRICE_COMPONENTS } from '@modules/pricing/calculators/corrugate/price-components';

import {
  inRollback,
  type MigratedDatabase,
  SQLSTATE,
  sqlState,
  startMigratedDatabase,
  stopMigratedDatabase,
} from '../support/database';

/** Database-level rules of the corrugate catalogue data and price components (U-B6, schema-design A-49). */
describe('corrugate pricing schema behaviour (PostgreSQL 18)', () => {
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
      "INSERT INTO print_types (code, product_type_id, name_th, name_en) VALUES ($1, $2, 'เฟล็กโซ', 'Flexo')",
      [`flexo_${++seq}`, type],
    );
  const flute = () =>
    id("INSERT INTO flute_types (code, name, layers) VALUES ($1, 'ลอน B', 3)", [`B${++seq}`]);
  const pattern = (type: string, formula = 'rsc') =>
    id("INSERT INTO patterns (product_type_id, code, name, corrugate_formula) VALUES ($1, $2, 'Test', $3)", [
      type,
      `p${++seq}`,
      formula,
    ]);
  const subPattern = (patternId: string) =>
    id("INSERT INTO sub_patterns (pattern_id, seq, name) VALUES ($1, $2, 'part')", [patternId, ++seq]);

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
    for (const d of CORRUGATE_PRICE_COMPONENTS) {
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
      // Every table column is either a descriptor column or bookkeeping.
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

  it('prices a pattern with at most one calculator', () =>
    inRollback(db.client, async () => {
      const type = await productType();
      expect(
        await sqlState(
          db.client,
          "INSERT INTO patterns (product_type_id, code, name, geometry_formula, corrugate_formula) VALUES ($1, 'both', 'x', 'flat', 'rsc')",
          [type],
        ),
      ).toBe(SQLSTATE.checkViolation);
      const p = await pattern(type, 'tele_body');
      expect(
        await sqlState(
          db.client,
          "INSERT INTO sub_patterns (pattern_id, seq, name, geometry_formula, corrugate_formula) VALUES ($1, 1, 'x', 'flat', 'tele_lid')",
          [p],
        ),
      ).toBe(SQLSTATE.checkViolation);
    }));

  it('checks corrugate terms and freezes them with the price-list version', () =>
    inRollback(db.client, async () => {
      const type = await productType();
      const pt = await printType(type);
      const version = await draftVersion(type);
      const terms = (key: string, variant: string, marginPct: number, method = 0) =>
        sqlState(
          db.client,
          `INSERT INTO pl_corrugate_print_type_terms (price_list_version_id, line_key, print_type_id, engine_variant,
             factory_margin_pct, pattern_area_percent_method) VALUES ($1, $2, $3, $4, $5, $6)`,
          [version, key, pt, variant, marginPct, method],
        );
      expect(await terms('k1', 'offset', 10)).toBe(SQLSTATE.checkViolation);
      expect(await terms('k1', 'flexo', 100)).toBe(SQLSTATE.checkViolation);
      expect(await terms('k1', 'flexo', 10, 3)).toBe(SQLSTATE.checkViolation);
      expect(await terms('k1', 'flexo', 12.5, 1)).toBeNull();
      await db.client.query(
        "UPDATE price_list_versions SET status = 'approved', decided_at = now() WHERE id = $1",
        [version],
      );
      expect(
        await sqlState(
          db.client,
          'UPDATE pl_corrugate_print_type_terms SET factory_margin_pct = 11 WHERE price_list_version_id = $1',
          [version],
        ),
      ).toBe(SQLSTATE.restrictViolation);
    }));

  it('requires RSC limits in order and the flexo / digital die-block shape of its kind', () =>
    inRollback(db.client, async () => {
      const type = await productType();
      const pt = await printType(type);
      const f = await flute();
      const version = await draftVersion(type);
      const process = (key: string, plMin: number, plMax: number) =>
        sqlState(
          db.client,
          `INSERT INTO pl_corrugate_process_terms (price_list_version_id, line_key, print_type_id, flute_type_id,
             trim_mm, min_length_m, min_sheet, width_layout_max, pl_rsc_min_in, pl_rsc_max_in, pw_rsc_min_in,
             pw_rsc_max_in, min_rsc_flap_mm, min_rsc_slh_mm, min_sll_mm, min_slw_mm, gap_mm, tl_mm, tw_mm,
             min_length_layout_slot)
           VALUES ($1, $2, $3, $4, 30, 100, 50, 6, $5, $6, 10, 90, 30, 30, 0, 0, 5, 10, 10, 1)`,
          [version, key, pt, f, plMin, plMax],
        );
      expect(await process('p1', 80, 40)).toBe(SQLSTATE.checkViolation);
      expect(await process('p1', 20, 120)).toBeNull();
      const block = (
        key: string,
        kind: string,
        maxW: number | null,
        price: number | null,
        sqm: number | null,
      ) =>
        sqlState(
          db.client,
          `INSERT INTO pl_corrugate_die_blocks (price_list_version_id, line_key, print_type_id, kind, block_max_w_in,
             block_max_l_in, block_price, min1lay_diecut_price, step_diecut_price, price_per_sqm)
           VALUES ($1, $2, $3, $4, $5, 40, $6, 0.5, 0.1, $7)`,
          [version, key, pt, kind, maxW, price, sqm],
        );
      expect(await block('b1', 'flexo', null, 3000, null)).toBe(SQLSTATE.checkViolation);
      expect(await block('b1', 'flexo', 60, null, null)).toBe(SQLSTATE.checkViolation);
      expect(await block('b1', 'digital', null, null, null)).toBe(SQLSTATE.checkViolation);
      expect(await block('b1', 'flexo', 60, 3000, null)).toBeNull();
      expect(await block('b2', 'digital', null, null, 120)).toBeNull();
    }));

  it('binds fixed options and pattern conditions to parts of the same pattern', () =>
    inRollback(db.client, async () => {
      const type = await productType();
      const [a, b] = [await pattern(type), await pattern(type)];
      const partOfB = await subPattern(b);
      const f = await flute();
      const assembly = await id(
        "INSERT INTO assemblies (code, name_th, name_en, auto_add) VALUES ($1, 'ค่าห่อ', 'Packing', true)",
        [`pack${++seq}`],
      );
      const version = await draftVersion(type);
      const option = (
        key: string,
        patternId: string,
        sub: string | null,
        kind: string,
        rounds: number | null,
      ) =>
        sqlState(
          db.client,
          `INSERT INTO pl_corrugate_fixed_options (price_list_version_id, line_key, pattern_id, sub_pattern_id,
             box_style, kind, assembly_id, delivery_rounds) VALUES ($1, $2, $3, $4, 'rsc', $5, $6, $7)`,
          [version, key, patternId, sub, kind, kind === 'assembly' ? assembly : null, rounds],
        );
      expect(await option('o1', a, partOfB, 'assembly', null)).toBe(SQLSTATE.checkViolation);
      expect(await option('o1', a, null, 'assembly', 2)).toBe(SQLSTATE.checkViolation);
      expect(await option('o1', a, null, 'assembly', null)).toBeNull();
      expect(await option('o2', b, partOfB, 'diecut_delivery_rounds', 2)).toBeNull();
      const condition = (key: string, patternId: string, sub: string | null) =>
        sqlState(
          db.client,
          `INSERT INTO pl_corrugate_pattern_conditions (price_list_version_id, line_key, flute_type_id, pattern_id,
             sub_pattern_id, plus_dl_mm, plus_dw_mm) VALUES ($1, $2, $3, $4, $5, 2, -1.5)`,
          [version, key, f, patternId, sub],
        );
      expect(await condition('c1', a, partOfB)).toBe(SQLSTATE.checkViolation);
      expect(await condition('c1', b, partOfB)).toBeNull();
    }));

  it('orders the bands of board, assembly and fix-cost lines', () =>
    inRollback(db.client, async () => {
      const type = await productType();
      const pt = await printType(type);
      const board = await id(
        "INSERT INTO materials (code, kind, name_th, name_en, coatable) VALUES ($1, 'corrugated_board', 'KA125', 'KA125', true)",
        [`ka${++seq}`],
      );
      const assembly = await id("INSERT INTO assemblies (code, name_th, name_en) VALUES ($1, 'x', 'x')", [
        `a${++seq}`,
      ]);
      const version = await draftVersion(type);
      expect(
        await sqlState(
          db.client,
          `INSERT INTO pl_board_prices (price_list_version_id, line_key, material_id, print_type_id, min_sheet, max_sheet,
             price_per_sqft) VALUES ($1, 'b1', $2, $3, 500, 100, 4.2)`,
          [version, board, pt],
        ),
      ).toBe(SQLSTATE.checkViolation);
      const assemblyPrice = (key: string, method: string, minDl: number | null, maxDl: number | null) =>
        sqlState(
          db.client,
          `INSERT INTO pl_corrugate_assembly_prices (price_list_version_id, line_key, print_type_id, assembly_id,
             min_dl_mm, max_dl_mm, method, price_per_pcs) VALUES ($1, $2, $3, $4, $5, $6, $7, 0.4)`,
          [version, key, pt, assembly, minDl, maxDl, method],
        );
      expect(await assemblyPrice('a1', 'per_carton', null, null)).toBe(SQLSTATE.checkViolation);
      expect(await assemblyPrice('a1', 'per_piece', 900, 300)).toBe(SQLSTATE.checkViolation);
      expect(await assemblyPrice('a1', 'per_piece', 300, 900)).toBeNull();
      expect(
        await sqlState(
          db.client,
          `INSERT INTO pl_fix_cost_pcts (price_list_version_id, line_key, print_type_id, basis, percent)
           VALUES ($1, 'f1', $2, 'box_area', 10)`,
          [version, pt],
        ),
      ).toBe(SQLSTATE.checkViolation);
      const level = await id(
        "INSERT INTO difficulty_levels (code, name_th, name_en) VALUES ($1, 'ปกติ', 'Normal')",
        [`lv${++seq}`],
      );
      // A die-cut line needs at least one of its prices.
      expect(
        await sqlState(
          db.client,
          `INSERT INTO pl_corrugate_diecut_prices (price_list_version_id, line_key, print_type_id, difficulty_level_id)
           VALUES ($1, 'd1', $2, $3)`,
          [version, pt, level],
        ),
      ).toBe(SQLSTATE.checkViolation);
    }));
});
