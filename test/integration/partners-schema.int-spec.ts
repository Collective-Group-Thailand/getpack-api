import {
  inRollback,
  type MigratedDatabase,
  SQLSTATE,
  sqlState,
  startMigratedDatabase,
  stopMigratedDatabase,
} from '../support/database';
import { PL_TEST_PRICES_SQL } from '../support/price-test-component';

/** Database-level rules of the partners context (schema-design §3.4, D-041, D-042, §8 bank accounts). */
describe('partners schema behaviour (PostgreSQL 18)', () => {
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
  async function factory(status = 'applied'): Promise<{ factory: string; vendor: string }> {
    const n = String(++seq).padStart(4, '0');
    const vendor = await id(
      "INSERT INTO vendors (kind, legal_name, juristic_type, tax_id) VALUES ('factory', 'โรงงานทดสอบ', 'company', $1)",
      [`000000000${n}`],
    );
    const factory = await id(
      `INSERT INTO factories (code, vendor_id, legal_name, juristic_type, tax_id, status, activated_at)
       VALUES ($1, $2, 'โรงงานทดสอบ', 'company', $3, $4::factory_status, CASE WHEN $4::text = 'active' THEN now() END)`,
      [`F${n}`, vendor, `000000000${n}`, status],
    );
    return { factory, vendor };
  }
  const user = () =>
    id("INSERT INTO users (kind, display_name, status, email) VALUES ('staff', 'Staff', 'active', $1)", [
      `staff${++seq}@example.invalid`,
    ]);

  async function approvedActivation(factoryId: string): Promise<void> {
    const entity = await id("INSERT INTO entities (code, display_name) VALUES ($1, 'Test')", [`E${++seq}`]);
    const policy = await id(
      "INSERT INTO approval_policies (key, subject_type, description) VALUES ('partner_activation', 'factory', 'Test')",
    );
    const version = await id(
      "INSERT INTO approval_policy_versions (policy_id, version_no, effective_from, reason) VALUES ($1, 1, now(), 'seed')",
      [policy],
    );
    await db.client.query(
      `INSERT INTO approval_requests (entity_id, policy_id, policy_version_id, subject_type, subject_id, subject_public_id,
         requester_user_id, payload_snapshot, status, decided_at)
       VALUES ($1, $2, $3, 'factory', $4, gen_random_uuid(), $5, '{}', 'approved', now())`,
      [entity, policy, version, factoryId, await user()],
    );
  }

  it('walks the partner lifecycle and refuses shortcuts', () =>
    inRollback(db.client, async () => {
      const { factory: f } = await factory();
      const move = (to: string) =>
        sqlState(db.client, 'UPDATE factories SET status = $2 WHERE id = $1', [f, to]);
      expect(await move('active')).toBe(SQLSTATE.checkViolation);
      expect(await move('under_review')).toBeNull();
      expect(await move('trial')).toBeNull();
      const { rows } = await db.client.query<{ status_changed_at: Date; created_at: Date }>(
        'SELECT status_changed_at, created_at FROM factories WHERE id = $1',
        [f],
      );
      expect(rows[0]!.status_changed_at.getTime()).toBeGreaterThanOrEqual(rows[0]!.created_at.getTime());
    }));

  it('activates only with a passed site visit and an approved partner_activation (D-041)', () =>
    inRollback(db.client, async () => {
      const { factory: f } = await factory('trial');
      const activate = () =>
        sqlState(db.client, "UPDATE factories SET status = 'active', activated_at = now() WHERE id = $1", [
          f,
        ]);
      expect(await activate()).toBe(SQLSTATE.checkViolation);

      const inspector = await user();
      await db.client.query(
        `INSERT INTO site_visits (factory_id, visited_on, checklist_version, checklist, result, recorded_by)
         VALUES ($1, current_date, 'v1', '{}', 'conditional', $2)`,
        [f, inspector],
      );
      expect(await activate()).toBe(SQLSTATE.checkViolation);
      await db.client.query(
        `INSERT INTO site_visits (factory_id, visited_on, checklist_version, checklist, result, recorded_by)
         VALUES ($1, current_date, 'v1', '{}', 'pass', $2)`,
        [f, inspector],
      );
      expect(await activate()).toBe(SQLSTATE.checkViolation); // still no approval
      await approvedActivation(f);
      expect(await activate()).toBeNull();
    }));

  it('never edits a bank account in place and keeps one active account per vendor', () =>
    inRollback(db.client, async () => {
      const { vendor } = await factory();
      const account = (status: string) =>
        id(
          `INSERT INTO vendor_bank_accounts (vendor_id, bank_code, account_name, account_no_enc, account_no_last4, account_no_hash,
             status, effective_from, decided_at)
           VALUES ($1, '014', 'โรงงานทดสอบ', '\\x01', '1234', $2, $3::bank_account_status,
             CASE WHEN $3::text = 'active' THEN now() END, CASE WHEN $3::text = 'active' THEN now() END)`,
          [vendor, Buffer.alloc(32, seq++), status],
        );
      const first = await account('active');
      expect(
        await sqlState(db.client, "UPDATE vendor_bank_accounts SET account_name = 'x' WHERE id = $1", [
          first,
        ]),
      ).toBe(SQLSTATE.restrictViolation);
      expect(await sqlState(db.client, 'DELETE FROM vendor_bank_accounts WHERE id = $1', [first])).toBe(
        SQLSTATE.restrictViolation,
      );
      const second = await account('pending_approval');
      expect(
        await sqlState(
          db.client,
          "UPDATE vendor_bank_accounts SET status = 'active', effective_from = now(), decided_at = now() WHERE id = $1",
          [second],
        ),
      ).toBe(SQLSTATE.uniqueViolation);
      await db.client.query("UPDATE vendor_bank_accounts SET status = 'superseded' WHERE id = $1", [first]);
      expect(
        await sqlState(
          db.client,
          "UPDATE vendor_bank_accounts SET status = 'active', effective_from = now(), decided_at = now() WHERE id = $1",
          [second],
        ),
      ).toBeNull();
      expect(
        await sqlState(db.client, "UPDATE vendor_bank_accounts SET status = 'active' WHERE id = $1", [first]),
      ).toBe(SQLSTATE.restrictViolation);
    }));

  it('applies a platform rate card only once accepted, and freezes decided versions (D-042, ADR-0005)', () =>
    inRollback(db.client, async () => {
      const { factory: f } = await factory();
      const category = await id(
        "INSERT INTO product_categories (code, name_th, name_en) VALUES ($1, 'x', 'x')",
        [`c${++seq}`],
      );
      const type = await id(
        "INSERT INTO product_types (code, category_id, name_th, name_en) VALUES ($1, $2, 'x', 'x')",
        [`t${++seq}`, category],
      );
      const list = await id('INSERT INTO price_lists (factory_id, product_type_id) VALUES ($1, $2)', [
        f,
        type,
      ]);
      const version = await id(
        `INSERT INTO price_list_versions (price_list_id, version_no, status, origin, effective_from, reason)
         VALUES ($1, 1, 'pending_acceptance', 'platform_rate_card', now(), 'Rate card v1')`,
        [list],
      );
      expect(
        await sqlState(
          db.client,
          "UPDATE price_list_versions SET status = 'approved', decided_at = now() WHERE id = $1",
          [version],
        ),
      ).toBe(SQLSTATE.checkViolation);
      expect(
        await sqlState(
          db.client,
          "UPDATE price_list_versions SET status = 'approved', decided_at = now(), factory_accepted_at = now() WHERE id = $1",
          [version],
        ),
      ).toBeNull();
      expect(
        await sqlState(db.client, 'UPDATE price_list_versions SET line_count = 9 WHERE id = $1', [version]),
      ).toBe(SQLSTATE.restrictViolation);
    }));

  it('checks capability items against the catalogue and keeps acceptances append-only', () =>
    inRollback(db.client, async () => {
      const { factory: f } = await factory();
      const category = await id(
        "INSERT INTO product_categories (code, name_th, name_en) VALUES ($1, 'x', 'x')",
        [`c${++seq}`],
      );
      const type = await id(
        "INSERT INTO product_types (code, category_id, name_th, name_en) VALUES ($1, $2, 'x', 'x')",
        [`t${++seq}`, category],
      );
      expect(
        await sqlState(
          db.client,
          "INSERT INTO factory_capability_items (factory_id, product_type_id, item_kind, item_id) VALUES ($1, $2, 'material', 999999)",
          [f, type],
        ),
      ).toBe(SQLSTATE.foreignKeyViolation);

      const template = await id(
        "INSERT INTO agreement_templates (key, name) VALUES ($1, 'Partner agreement')",
        [`partner_agreement_${++seq}`],
      );
      const version = await id(
        `INSERT INTO agreement_template_versions (template_id, version_no, effective_from, status, text_th, text_sha256, reason, decided_at)
         VALUES ($1, 1, now(), 'approved', 'ข้อความ', $2, 'v1', now())`,
        [template, Buffer.alloc(32, 1)],
      );
      const acceptance = await id(
        `INSERT INTO agreement_acceptances (factory_id, template_version_id, accepted_by_user_id, method, evidence_sha256)
         VALUES ($1, $2, $3, 'e_acceptance', $4)`,
        [f, version, await user(), Buffer.alloc(32, 2)],
      );
      expect(
        await sqlState(db.client, "UPDATE agreement_acceptances SET user_agent = 'x' WHERE id = $1", [
          acceptance,
        ]),
      ).toBe(SQLSTATE.restrictViolation);
    }));

  it('keeps a postcode in the zone scheme of its zone (composite FK)', () =>
    inRollback(db.client, async () => {
      const schemeA = await id("INSERT INTO zone_schemes (code, name) VALUES ($1, 'A')", [`a${++seq}`]);
      const schemeB = await id("INSERT INTO zone_schemes (code, name) VALUES ($1, 'B')", [`b${++seq}`]);
      const zone = await id(
        "INSERT INTO zones (scheme_id, code, name_th, name_en) VALUES ($1, 'Z1', 'x', 'x')",
        [schemeA],
      );
      expect(
        await sqlState(
          db.client,
          "INSERT INTO zone_postcodes (zone_id, scheme_id, postcode) VALUES ($1, $2, '10200')",
          [zone, schemeB],
        ),
      ).toBe(SQLSTATE.foreignKeyViolation);
      expect(
        await sqlState(
          db.client,
          "INSERT INTO zone_postcodes (zone_id, scheme_id, postcode) VALUES ($1, $2, '10200')",
          [zone, schemeA],
        ),
      ).toBeNull();
    }));

  it('requires Monday week starts for capacity overrides and bookings', () =>
    inRollback(db.client, async () => {
      const { factory: f } = await factory();
      const category = await id(
        "INSERT INTO product_categories (code, name_th, name_en) VALUES ($1, 'x', 'x')",
        [`c${++seq}`],
      );
      const type = await id(
        "INSERT INTO product_types (code, category_id, name_th, name_en) VALUES ($1, $2, 'x', 'x')",
        [`t${++seq}`, category],
      );
      const override = (day: string) =>
        sqlState(
          db.client,
          "INSERT INTO factory_capacity_overrides (factory_id, product_type_id, week_start, capacity, reason) VALUES ($1, $2, $3, 10, 'Maintenance')",
          [f, type, day],
        );
      expect(await override('2026-09-29')).toBe(SQLSTATE.checkViolation); // a Tuesday
      expect(await override('2026-09-28')).toBeNull(); // a Monday
    }));

  it('freezes component rows with their version and keeps one open proposal per price list (A-7, D-040)', () =>
    inRollback(db.client, async () => {
      for (const sql of PL_TEST_PRICES_SQL) await db.client.query(sql);
      const { factory: f } = await factory();
      const category = await id(
        "INSERT INTO product_categories (code, name_th, name_en) VALUES ($1, 'x', 'x')",
        [`c${++seq}`],
      );
      const type = await id(
        "INSERT INTO product_types (code, category_id, name_th, name_en) VALUES ($1, $2, 'x', 'x')",
        [`t${++seq}`, category],
      );
      const material = await id(
        "INSERT INTO materials (code, kind, name_th, name_en) VALUES ($1, 'paper', 'x', 'x')",
        [`m${++seq}`],
      );
      const list = await id('INSERT INTO price_lists (factory_id, product_type_id) VALUES ($1, $2)', [
        f,
        type,
      ]);
      const version = await id(
        `INSERT INTO price_list_versions (price_list_id, version_no, origin, effective_from, reason)
         VALUES ($1, 1, 'factory_proposal', now(), 'v1')`,
        [list],
      );
      const insert = (v: string, key: string) =>
        sqlState(
          db.client,
          'INSERT INTO pl_test_prices (price_list_version_id, line_key, material_id, qty_from, rate) VALUES ($1, $2, $3, 1, 5)',
          [v, key, material],
        );
      expect(await insert(version, 'a')).toBeNull(); // draft: writable
      await db.client.query(
        "UPDATE price_list_versions SET status = 'approved', decided_at = now() WHERE id = $1",
        [version],
      );
      expect(await insert(version, 'b')).toBe(SQLSTATE.restrictViolation);
      expect(
        await sqlState(db.client, 'UPDATE pl_test_prices SET rate = 6 WHERE price_list_version_id = $1', [
          version,
        ]),
      ).toBe(SQLSTATE.restrictViolation);
      expect(
        await sqlState(db.client, 'DELETE FROM pl_test_prices WHERE price_list_version_id = $1', [version]),
      ).toBe(SQLSTATE.restrictViolation);

      const pending = await id(
        `INSERT INTO price_list_versions (price_list_id, version_no, status, origin, effective_from, reason)
         VALUES ($1, 2, 'pending_acceptance', 'platform_rate_card', now(), 'Rate card')`,
        [list],
      );
      expect(await insert(pending, 'a')).toBeNull(); // a rate card under negotiation is still writable

      const proposal = (status: string) =>
        sqlState(
          db.client,
          `INSERT INTO price_proposals (price_list_id, direction, status, proposed_effective_from)
           VALUES ($1, 'factory_to_getpack', $2::proposal_status, now())`,
          [list, status],
        );
      expect(await proposal('draft')).toBeNull();
      expect(await proposal('submitted')).toBe(SQLSTATE.uniqueViolation);
      expect(await proposal('approved')).toBeNull(); // closed proposals do not count
    }));
});
