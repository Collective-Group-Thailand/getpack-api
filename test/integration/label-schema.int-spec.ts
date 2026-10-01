import { columnOf } from '@modules/partners/pricing/price-component.registry';
import { LABEL_PRICE_COMPONENTS } from '@modules/pricing/calculators/label/price-components';

import {
  inRollback,
  type MigratedDatabase,
  SQLSTATE,
  sqlState,
  startMigratedDatabase,
  stopMigratedDatabase,
} from '../support/database';

/** Database-level rules of the label price components (U-B6 label, schema-design A-71). */
describe('label pricing schema behaviour (PostgreSQL 18)', () => {
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
      [`digital_${++seq}`, type],
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
    for (const d of LABEL_PRICE_COMPONENTS) {
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

  it('checks label terms and freezes them with the price-list version', () =>
    inRollback(db.client, async () => {
      const type = await productType();
      const pt = await printType(type);
      const version = await draftVersion(type);
      const terms = (key: string, variant: string, marginPct: number, wasteMethod = 1) =>
        sqlState(
          db.client,
          `INSERT INTO pl_label_print_type_terms (price_list_version_id, line_key, print_type_id, engine_variant,
             factory_margin_pct, waste_method) VALUES ($1, $2, $3, $4, $5, $6)`,
          [version, key, pt, variant, marginPct, wasteMethod],
        );
      expect(await terms('k1', 'flexo', 10)).toBe(SQLSTATE.checkViolation);
      expect(await terms('k1', 'digital', 100)).toBe(SQLSTATE.checkViolation);
      expect(await terms('k1', 'digital', 10, 3)).toBe(SQLSTATE.checkViolation);
      expect(await terms('k1', 'digital', 12.5, 2)).toBeNull();
      await db.client.query(
        "UPDATE price_list_versions SET status = 'approved', decided_at = now() WHERE id = $1",
        [version],
      );
      expect(
        await sqlState(
          db.client,
          'UPDATE pl_label_print_type_terms SET factory_margin_pct = 11 WHERE price_list_version_id = $1',
          [version],
        ),
      ).toBe(SQLSTATE.restrictViolation);
    }));

  it('allows a roll-to-sheet cut length only on a roll', () =>
    inRollback(db.client, async () => {
      const version = await draftVersion(await productType());
      const sheet = (key: string, sheetLIn: number, cutLengthIn: number) =>
        sqlState(
          db.client,
          `INSERT INTO pl_label_paper_sheets (price_list_version_id, line_key, size_w_in, size_l_in, sheet_cut,
             sheet_w_in, sheet_l_in, sheet_cut_length_in) VALUES ($1, $2, 13, 0, 1, 13, $3, $4)`,
          [version, key, sheetLIn, cutLengthIn],
        );
      expect(await sheet('s1', 19, 12)).toBe(SQLSTATE.checkViolation);
      expect(await sheet('s2', 0, 12)).toBeNull();
      expect(await sheet('s3', 19, 0)).toBeNull();
    }));
});
