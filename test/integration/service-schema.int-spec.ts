import { columnOf } from '@modules/partners/pricing/price-component.registry';
import { SERVICE_PRICE_COMPONENTS } from '@modules/pricing/calculators/service/price-components';

import {
  inRollback,
  type MigratedDatabase,
  SQLSTATE,
  sqlState,
  startMigratedDatabase,
  stopMigratedDatabase,
} from '../support/database';

/** Database-level rules of the service price component (U-B6 service, schema-design A-75). */
describe('service pricing schema behaviour (PostgreSQL 18)', () => {
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
      [`svc_${++seq}`, type],
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
    for (const d of SERVICE_PRICE_COMPONENTS) {
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

  it('checks the unit cost and freezes the line with the version', () =>
    inRollback(db.client, async () => {
      const type = await productType();
      const pt = await printType(type);
      const version = await draftVersion(type);
      const item = await id(
        `INSERT INTO catalog_products (product_type_id, slug, name_th, name_en, template_availability)
         VALUES ($1, $2, 'ค่าแม่พิมพ์', 'Plate', 'none')`,
        [type, `plate-${++seq}`],
      );
      const line = (key: string, cost: number) =>
        sqlState(
          db.client,
          `INSERT INTO pl_service_prices (price_list_version_id, line_key, print_type_id, catalog_product_id, unit_cost)
           VALUES ($1, $2, $3, $4, $5)`,
          [version, key, pt, item, cost],
        );
      expect(await line('l1', 0)).toBe(SQLSTATE.checkViolation);
      expect(await line('l1', 1000)).toBeNull();
      await db.client.query(
        "UPDATE price_list_versions SET status = 'approved', decided_at = now() WHERE id = $1",
        [version],
      );
      expect(
        await sqlState(
          db.client,
          'UPDATE pl_service_prices SET unit_cost = 900 WHERE price_list_version_id = $1',
          [version],
        ),
      ).toBe(SQLSTATE.restrictViolation);
    }));
});
