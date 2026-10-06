import { PrismaPg } from '@prisma/adapter-pg';

import { UAT_FACTORY_CODE } from '../../prisma/seed/uat/uat-catalog';
import { UAT_PRODUCTS, UAT_STOCK_PRODUCTS } from '../../prisma/seed/uat/uat-data';
import { seedUat } from '../../prisma/seed/uat/uat-seed';
import { PrismaClient } from '../../src/generated/prisma/client';
import { type MigratedDatabase, startMigratedDatabase, stopMigratedDatabase } from '../support/database';

/** `pnpm db:seed:uat` (docs/launch/UAT-DATA.md): the rehearsal catalogue, its copied prices, idempotence. */
describe('UAT rehearsal seed (PostgreSQL 18)', () => {
  let db: MigratedDatabase;
  let prisma: PrismaClient;
  let first: Record<string, number>;

  beforeAll(async () => {
    db = await startMigratedDatabase();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: db.url }) });
    first = await seedUat(prisma, {});
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await stopMigratedDatabase(db);
  });

  it('creates the rehearsal catalogue once, with UAT document series, and changes nothing on a second run', async () => {
    expect(first).toMatchObject({
      uat_catalog_products: UAT_PRODUCTS.length,
      uat_stock_products: UAT_STOCK_PRODUCTS.length,
      uat_people: 8,
    });
    expect(await seedUat(prisma, {})).toEqual({});
    const prefixes = (await prisma.documentSeries.findMany()).map((s) => s.prefix);
    expect(prefixes.length).toBeGreaterThan(0);
    expect(prefixes.every((p) => p.startsWith('UAT'))).toBe(true);
    // Only types whose validation document is signed are instant (A-16); one launch factory (D-101).
    const instant = (await prisma.productType.findMany({ where: { quoteMode: 'instant' } })).map(
      (t) => t.code,
    );
    expect(instant).toEqual(['corrugated']);
    expect((await prisma.factory.findUniqueOrThrow({ where: { code: 'F9002' } })).status).toBe('suspended');
    expect(
      await prisma.catalogProduct.count({ where: { slug: { startsWith: 'dev-' }, status: 'active' } }),
    ).toBe(3);
  });

  it('keeps every line of the dev price list in the rehearsal version and adds the copies (no price invented)', async () => {
    const versions = await db.client.query<{ code: string; version_no: number; line_count: number }>(
      `SELECT pt.code, v.version_no, v.line_count
         FROM price_list_versions v
         JOIN price_lists l ON l.id = v.price_list_id
         JOIN product_types pt ON pt.id = l.product_type_id
         JOIN factories f ON f.id = l.factory_id
        WHERE f.code = $1 AND v.status = 'approved'
        ORDER BY pt.code, v.version_no`,
      [UAT_FACTORY_CODE],
    );
    const byType = new Map<string, number[]>();
    for (const r of versions.rows) byType.set(r.code, [...(byType.get(r.code) ?? []), r.line_count]);
    expect([...byType.keys()].sort()).toEqual([
      'corrugated',
      'flexible_pouch',
      'folding_carton',
      'label_sticker',
      'service',
      'standard_product',
      'tag_sleeve',
    ]);
    for (const [type, [v1, v2]] of byType) {
      expect(v2! - v1!).toBe(first[`uat_price_lines_${type}`]);
    }
    // A copied material line carries the dev line's values unchanged.
    const costs = await db.client.query<{ code: string; cost: string }>(
      `SELECT m.code, p.cost_per_kg::text AS cost
         FROM pl_material_prices p JOIN materials m ON m.id = p.material_id
        WHERE m.code IN ('dev-art-350', 'uat-art-400') AND p.price_list_version_id = (
          SELECT v.id FROM price_list_versions v JOIN price_lists l ON l.id = v.price_list_id
            JOIN product_types pt ON pt.id = l.product_type_id
           WHERE pt.code = 'folding_carton' AND l.factory_id = (SELECT id FROM factories WHERE code = $1)
           ORDER BY v.version_no DESC LIMIT 1)`,
      [UAT_FACTORY_CODE],
    );
    expect(new Set(costs.rows.map((r) => r.cost)).size).toBe(1);
    expect(costs.rows.map((r) => r.code).sort()).toEqual(['dev-art-350', 'uat-art-400']);
  });

  it('gives every product with a calculator a reference configuration and every RFQ product none', async () => {
    const products = await prisma.catalogProduct.findMany({
      where: { slug: { startsWith: 'uat-' } },
      include: { productType: true },
    });
    for (const p of products) {
      const priced = ['folding_carton', 'corrugated', 'label_sticker', 'tag_sleeve', 'flexible_pouch'];
      expect([p.slug, p.referenceConfiguration !== null]).toEqual([
        p.slug,
        priced.includes(p.productType.code),
      ]);
    }
  });
});
