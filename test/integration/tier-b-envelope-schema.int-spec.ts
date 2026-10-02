import {
  inRollback,
  type MigratedDatabase,
  SQLSTATE,
  sqlState,
  startMigratedDatabase,
  stopMigratedDatabase,
} from '../support/database';

/** Database rule of the tier-B envelope (U-B6 tail, schema-design A-77, D-234): only tier B carries one, an object. */
describe('tier-B envelope schema behaviour (PostgreSQL 18)', () => {
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

  it('accepts an envelope object on tier B only', () =>
    inRollback(db.client, async () => {
      const category = await id(
        "INSERT INTO product_categories (code, name_th, name_en) VALUES ('env_cat', 'หมวด', 'Category')",
      );
      const type = await id(
        "INSERT INTO product_types (code, category_id, name_th, name_en) VALUES ('env_type', $1, 'ประเภท', 'Type')",
        [category],
      );
      const vendor = await id(
        "INSERT INTO vendors (kind, legal_name, juristic_type, tax_id) VALUES ('factory', 'โรงงานทดสอบ', 'company', '0000000020001')",
      );
      const factory = await id(
        `INSERT INTO factories (code, vendor_id, legal_name, juristic_type, tax_id)
         VALUES ('FE001', $1, 'โรงงานทดสอบ', 'company', '0000000020001')`,
        [vendor],
      );
      const participation = await id(
        'INSERT INTO factory_participations (factory_id, product_type_id) VALUES ($1, $2)',
        [factory, type],
      );
      let no = 0;
      const version = (tier: string, envelope: string | null) =>
        sqlState(
          db.client,
          `INSERT INTO factory_participation_versions (participation_id, version_no, effective_from, tier, envelope, reason)
           VALUES ($1, $2, now(), $3, $4::jsonb, 'test')`,
          [participation, ++no, tier, envelope],
        );
      expect(await version('A', '{"quantity":{"min":1,"max":null}}')).toBe(SQLSTATE.checkViolation);
      expect(await version('B', '["not", "an", "object"]')).toBe(SQLSTATE.checkViolation);
      expect(await version('B', '{"quantity":{"min":500,"max":null}}')).toBeNull();
      expect(await version('C', null)).toBeNull();
    }));
});
