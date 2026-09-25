import {
  inRollback,
  type MigratedDatabase,
  SQLSTATE,
  sqlState,
  startMigratedDatabase,
  stopMigratedDatabase,
} from '../support/database';

/** Database-level rules of the catalogue context (docs/schema-design.md §3.3, D-100, §1.5). */
describe('catalogue schema behaviour (PostgreSQL 18)', () => {
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

  async function productType(code = 'folding_carton'): Promise<string> {
    const category = await id(
      "INSERT INTO product_categories (code, name_th, name_en) VALUES ($1, 'หมวดทดสอบ', 'Test category')",
      [`cat_${code}`],
    );
    return id(
      "INSERT INTO product_types (code, category_id, name_th, name_en) VALUES ($1, $2, 'ประเภททดสอบ', 'Test type')",
      [code, category],
    );
  }

  async function catalogProduct(): Promise<string> {
    return id(
      "INSERT INTO catalog_products (product_type_id, slug, name_th, name_en) VALUES ($1, 'test-box', 'กล่องทดสอบ', 'Test box')",
      [await productType()],
    );
  }

  it('refuses an instant product type without a calculator (D-100)', () =>
    inRollback(db.client, async () => {
      const type = await productType();
      expect(
        await sqlState(db.client, "UPDATE product_types SET quote_mode = 'instant' WHERE id = $1", [type]),
      ).toBe(SQLSTATE.checkViolation);
      expect(
        await sqlState(
          db.client,
          "UPDATE product_types SET quote_mode = 'instant', calculator_key = 'folding' WHERE id = $1",
          [type],
        ),
      ).toBeNull();
    }));

  it('checks catalogue product options against the table of their kind', () =>
    inRollback(db.client, async () => {
      const product = await catalogProduct();
      const material = await id(
        "INSERT INTO materials (code, kind, name_th, name_en) VALUES ('art-card-350', 'paper', 'อาร์ตการ์ด', 'Art card')",
      );
      const insert = (kind: string, optionId: string) =>
        sqlState(
          db.client,
          'INSERT INTO catalog_product_options (catalog_product_id, option_kind, option_id) VALUES ($1, $2, $3)',
          [product, kind, optionId],
        );

      expect(await insert('material', material)).toBeNull();
      expect(await insert('finish', material)).toBe(SQLSTATE.foreignKeyViolation);
      expect(await insert('material', '999999')).toBe(SQLSTATE.foreignKeyViolation);
      // No definition table yet: refused until a deliverable defines the kind.
      expect(await insert('print_side', '1')).toBe(SQLSTATE.foreignKeyViolation);
    }));

  it('accepts only coatings and laminations as the coating option', () =>
    inRollback(db.client, async () => {
      const product = await catalogProduct();
      const foil = await id(
        "INSERT INTO finishes (code, name_th, name_en, finish_kind) VALUES ('hot-foil', 'ฟอยล์', 'Foil', 'foil')",
      );
      const varnish = await id(
        "INSERT INTO finishes (code, name_th, name_en, finish_kind) VALUES ('varnish', 'วานิช', 'Varnish', 'coating')",
      );
      const insert = (optionId: string) =>
        sqlState(
          db.client,
          "INSERT INTO catalog_product_options (catalog_product_id, option_kind, option_id) VALUES ($1, 'coating', $2)",
          [product, optionId],
        );
      expect(await insert(foil)).toBe(SQLSTATE.foreignKeyViolation);
      expect(await insert(varnish)).toBeNull();
    }));

  it('keeps a stock attribute consistent with its value (composite FK)', () =>
    inRollback(db.client, async () => {
      const stock = await id(
        "INSERT INTO stock_products (product_type_id, sku, name_th, name_en, unit) VALUES ($1, 'DEV-0001', 'ขวดทดสอบ', 'Test bottle', 'piece')",
        [await productType('standard_product')],
      );
      const colour = await id(
        "INSERT INTO stock_attribute_values (attribute, code, name_th, name_en) VALUES ('colour', 'clear', 'ใส', 'Clear')",
      );
      expect(
        await sqlState(
          db.client,
          "INSERT INTO stock_product_attributes (stock_product_id, attribute, value_id) VALUES ($1, 'shape', $2)",
          [stock, colour],
        ),
      ).toBe(SQLSTATE.foreignKeyViolation);
      expect(
        await sqlState(
          db.client,
          "INSERT INTO stock_product_attributes (stock_product_id, attribute, value_id) VALUES ($1, 'colour', $2)",
          [stock, colour],
        ),
      ).toBeNull();
    }));

  it('keeps the stock ledger append-only', () =>
    inRollback(db.client, async () => {
      const stock = await id(
        "INSERT INTO stock_products (product_type_id, sku, name_th, name_en, unit) VALUES ($1, 'DEV-0002', 'ขวดทดสอบ', 'Test bottle', 'piece')",
        [await productType('standard_product')],
      );
      const movement = await id(
        "INSERT INTO stock_movements (stock_product_id, factory_id, kind, quantity, balance_after) VALUES ($1, 1, 'receipt', 10, 10)",
        [stock],
      );
      expect(
        await sqlState(db.client, 'UPDATE stock_movements SET quantity = 5 WHERE id = $1', [movement]),
      ).toBe(SQLSTATE.restrictViolation);
      expect(await sqlState(db.client, 'DELETE FROM stock_movements WHERE id = $1', [movement])).toBe(
        SQLSTATE.restrictViolation,
      );
    }));

  it('checks the subject of a video', () =>
    inRollback(db.client, async () => {
      const product = await catalogProduct();
      const insert = (subjectType: string, subjectId: string) =>
        sqlState(
          db.client,
          "INSERT INTO videos (provider, url, subject_type, subject_id) VALUES ('youtube', 'https://www.youtube.com/watch?v=test', $1, $2)",
          [subjectType, subjectId],
        );
      expect(await insert('catalog_product', product)).toBeNull();
      expect(await insert('article', product)).toBe(SQLSTATE.foreignKeyViolation);
    }));

  it('frees a soft-deleted slug for reuse', () =>
    inRollback(db.client, async () => {
      const article = await id(
        "INSERT INTO articles (slug, title_th) VALUES ('how-to-choose-a-box', 'วิธีเลือกกล่อง')",
      );
      expect(
        await sqlState(
          db.client,
          "INSERT INTO articles (slug, title_th) VALUES ('how-to-choose-a-box', 'ซ้ำ')",
        ),
      ).toBe(SQLSTATE.uniqueViolation);
      await db.client.query('UPDATE articles SET deleted_at = now() WHERE id = $1', [article]);
      expect(
        await sqlState(
          db.client,
          "INSERT INTO articles (slug, title_th) VALUES ('how-to-choose-a-box', 'ใหม่')",
        ),
      ).toBeNull();
    }));

  it('validates postcodes, slugs and one price summary per product and zone', () =>
    inRollback(db.client, async () => {
      const province = await id(
        "INSERT INTO geo_provinces (code, name_th, name_en) VALUES ('99', 'ทดสอบ', 'Test')",
      );
      const district = await id(
        "INSERT INTO geo_districts (province_id, code, name_th, name_en) VALUES ($1, '9901', 'ทดสอบ', 'Test')",
        [province],
      );
      expect(
        await sqlState(
          db.client,
          "INSERT INTO geo_subdistricts (district_id, code, name_th, name_en, postcode) VALUES ($1, '990101', 'ทดสอบ', 'Test', '9A999')",
          [district],
        ),
      ).toBe(SQLSTATE.checkViolation);
      expect(
        await sqlState(
          db.client,
          "INSERT INTO catalog_products (product_type_id, slug, name_th, name_en) VALUES ($1, 'Bad Slug', 'x', 'x')",
          [await productType('corrugated')],
        ),
      ).toBe(SQLSTATE.checkViolation);

      const stock = await id(
        "INSERT INTO stock_products (product_type_id, sku, name_th, name_en, unit) VALUES ($1, 'DEV-0003', 'ขวด', 'Bottle', 'piece')",
        [await productType('standard_product')],
      );
      const summary = `INSERT INTO stock_product_price_summaries (stock_product_id, zone_code, min_unit_price_with_delivery, computed_at)
                        VALUES ($1, NULL, 1.5, now())`;
      expect(await sqlState(db.client, summary, [stock])).toBeNull();
      expect(await sqlState(db.client, summary, [stock])).toBe(SQLSTATE.uniqueViolation);
    }));
});
