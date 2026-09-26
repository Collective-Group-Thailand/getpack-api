import {
  inRollback,
  type MigratedDatabase,
  SQLSTATE,
  sqlState,
  startMigratedDatabase,
  stopMigratedDatabase,
} from '../support/database';

/** Database-level rules of the folding geometry data and its first price components (B2.3, A-24, A-25). */
describe('folding geometry schema behaviour (PostgreSQL 18)', () => {
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
  const pattern = (type: string) =>
    id(
      "INSERT INTO patterns (product_type_id, code, name, geometry_formula) VALUES ($1, $2, 'Test', 'flat')",
      [type, `p${++seq}`],
    );
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

  it('keeps geometry bands of a table from overlapping; bounds are inclusive', () =>
    inRollback(db.client, async () => {
      const table = await id(
        "INSERT INTO geometry_band_tables (code, name) VALUES ('flap_by_length', 'Flap')",
      );
      const band = (lower: number, upper: number) =>
        sqlState(
          db.client,
          'INSERT INTO geometry_bands (table_id, lower, upper, value) VALUES ($1, $2, $3, 10)',
          [table, lower, upper],
        );
      expect(await band(0, 50)).toBeNull();
      expect(await band(50, 100)).toBe(SQLSTATE.exclusionViolation); // 50 is in both
      expect(await band(50.01, 100)).toBeNull();
      expect(await band(120, 110)).toBe(SQLSTATE.checkViolation);
    }));

  it('binds condition slots only to parts of the same pattern, once per slot and position', () =>
    inRollback(db.client, async () => {
      const type = await productType();
      const [a, b] = [await pattern(type), await pattern(type)];
      const partOfB = await subPattern(b);
      const table = await id(
        "INSERT INTO geometry_band_tables (code, name) VALUES ('flap_by_width', 'Flap')",
      );
      const condition = await id(
        "INSERT INTO geometry_conditions (code, band_table_id, variable, determinant) VALUES ('f_by_w', $1, 'f', 'w')",
        [table],
      );
      const bind = (patternId: string, sub: string | null) =>
        sqlState(
          db.client,
          "INSERT INTO pattern_geometry_conditions (pattern_id, sub_pattern_id, slot, condition_id) VALUES ($1, $2, 'dw', $3)",
          [patternId, sub, condition],
        );
      expect(await bind(a, null)).toBeNull();
      expect(await bind(a, null)).toBe(SQLSTATE.uniqueViolation);
      expect(await bind(a, partOfB)).toBe(SQLSTATE.checkViolation);
      expect(await bind(b, partOfB)).toBeNull();
    }));

  it('checks folding terms and freezes them with the price-list version', () =>
    inRollback(db.client, async () => {
      const type = await productType();
      const printType = await id(
        "INSERT INTO print_types (code, product_type_id, name_th, name_en) VALUES ($1, $2, 'ออฟเซ็ท', 'Offset')",
        [`offset_${++seq}`, type],
      );
      const version = await draftVersion(type);
      const terms = (key: string, variant: string, marginPct: number) =>
        sqlState(
          db.client,
          `INSERT INTO pl_print_type_terms (price_list_version_id, line_key, print_type_id, engine_variant, waste_method,
             finish2_step_down_waste, can_flip_paper_size, disable_overlap_layout, factory_margin_pct)
           VALUES ($1, $2, $3, $4, 1, false, false, false, $5)`,
          [version, key, printType, variant, marginPct],
        );
      expect(await terms('k1', 'c', 10)).toBe(SQLSTATE.checkViolation);
      expect(await terms('k1', 'a', 100)).toBe(SQLSTATE.checkViolation);
      expect(await terms('k1', 'a', 12.5)).toBeNull();
      await db.client.query(
        "UPDATE price_list_versions SET status = 'approved', decided_at = now() WHERE id = $1",
        [version],
      );
      expect(
        await sqlState(
          db.client,
          'UPDATE pl_print_type_terms SET factory_margin_pct = 11 WHERE price_list_version_id = $1',
          [version],
        ),
      ).toBe(SQLSTATE.restrictViolation);
    }));

  it('requires at least one paper price and ordered quantity bands', () =>
    inRollback(db.client, async () => {
      const type = await productType();
      const printType = await id(
        "INSERT INTO print_types (code, product_type_id, name_th, name_en) VALUES ($1, $2, 'ดิจิทัล', 'Digital')",
        [`digital_${++seq}`, type],
      );
      const material = await id(
        "INSERT INTO materials (code, kind, name_th, name_en) VALUES ($1, 'paper', 'x', 'x')",
        [`m${++seq}`],
      );
      const version = await draftVersion(type);
      const price = (key: string, perKg: number | null, min: number | null, max: number | null) =>
        sqlState(
          db.client,
          `INSERT INTO pl_material_prices (price_list_version_id, line_key, material_id, print_type_id, min_paper_amount,
             max_paper_amount, cost_per_kg) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [version, key, material, printType, min, max, perKg],
        );
      expect(await price('k1', null, null, null)).toBe(SQLSTATE.checkViolation);
      expect(await price('k1', 32, 100, 50)).toBe(SQLSTATE.checkViolation);
      expect(await price('k1', 32, null, null)).toBeNull();
    }));
});
