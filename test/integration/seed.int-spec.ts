import { PERMISSIONS } from '@modules/iam/permissions.catalog';
import { ROLES } from '@modules/iam/roles.catalog';
import { PrismaPg } from '@prisma/adapter-pg';

import { APPROVAL_POLICIES } from '../../prisma/seed/data/approval-policies';
import { SETTINGS } from '../../prisma/seed/data/settings';
import { seedDev } from '../../prisma/seed/dev-seed';
import { seedReference } from '../../prisma/seed/reference-seed';
import { PrismaClient } from '../../src/generated/prisma/client';
import { type MigratedDatabase, startMigratedDatabase, stopMigratedDatabase } from '../support/database';

describe('seeds (PostgreSQL 18)', () => {
  let db: MigratedDatabase;
  let prisma: PrismaClient;

  beforeAll(async () => {
    db = await startMigratedDatabase();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: db.url }) });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await stopMigratedDatabase(db);
  });

  const count = async (table: string) =>
    Number((await db.client.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0]!.n);

  it('seeds the dev data once and changes nothing on the second run', async () => {
    const first = await seedDev(prisma);
    expect(first).toMatchObject({
      entities: 1,
      roles: ROLES.length,
      permissions: PERMISSIONS.length,
      settings: SETTINGS.length + 8,
      approval_policies: APPROVAL_POLICIES.length,
      dev_staff_users: 16,
      dev_customer_users: 1,
    });

    const snapshot = await db.client.query(
      "SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) AS h FROM (SELECT * FROM permissions) t",
    );
    await expect(seedDev(prisma)).resolves.toEqual({});
    const again = await db.client.query(
      "SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) AS h FROM (SELECT * FROM permissions) t",
    );
    expect(again.rows[0]).toEqual(snapshot.rows[0]);
    expect(await count("audit_logs WHERE action = 'seed.reference_applied'")).toBe(1);
  });

  it('seeds one approved v1 per valued setting, effective before any business activity, citing its decisions', async () => {
    const { rows } = await db.client.query<{
      key: string;
      versions: string;
      status: string;
      refs: string[];
    }>(`
      SELECT s.key, count(v.id) AS versions, min(v.status::text) AS status, s.decision_refs AS refs
        FROM settings s JOIN setting_versions v ON v.setting_id = s.id
       GROUP BY s.id`);
    // Definition-only settings (no decided value, e.g. D-172) have no version yet.
    expect(rows).toHaveLength(SETTINGS.filter((setting) => !setting.unset).length + 8);
    for (const row of rows) {
      expect([row.key, row.versions, row.status]).toEqual([row.key, '1', 'approved']);
      expect(row.refs.every((ref) => /^D-\d{3}$/.test(ref))).toBe(true);
    }
  });

  it('seeds VAT and the customer withholding design defaults as dated, approved versions (accounting-design §2, A-22)', async () => {
    const { rows } = await db.client.query<{ code: string; rate: string; status: string; versions: string }>(`
      SELECT t.code, min(v.rate_pct)::text AS rate, min(v.status::text) AS status, count(v.id) AS versions
        FROM tax_rates t JOIN tax_rate_versions v ON v.tax_rate_id = t.id
       GROUP BY t.id ORDER BY t.code`);
    expect(rows).toEqual([
      { code: 'vat_standard', rate: '7.0000', status: 'approved', versions: '1' },
      { code: 'wht_commission', rate: '3.0000', status: 'approved', versions: '1' },
      { code: 'wht_customer_hire_of_work', rate: '3.0000', status: 'approved', versions: '1' },
      { code: 'wht_customer_service', rate: '3.0000', status: 'approved', versions: '1' },
      { code: 'wht_customer_transport', rate: '1.0000', status: 'approved', versions: '1' },
      { code: 'wht_hire_of_work', rate: '3.0000', status: 'approved', versions: '1' },
      { code: 'wht_service', rate: '3.0000', status: 'approved', versions: '1' },
      { code: 'wht_transport', rate: '1.0000', status: 'approved', versions: '1' },
    ]);
  });

  it('seeds the chart of accounts and the default posting rules as approved versions (B5.1, §3, §5)', async () => {
    const { rows } = await db.client.query<{ code: string; control: boolean; required: string }>(`
      SELECT code, is_control AS control, required_dimensions::text AS required FROM accounts WHERE is_control ORDER BY code`);
    expect(rows).toEqual([
      { code: '1210', control: true, required: '{customer}' },
      { code: '1250', control: true, required: '{vendor}' },
      { code: '2110', control: true, required: '{vendor}' },
      { code: '2120', control: true, required: '{vendor}' },
    ]);
    const rules = await db.client.query<{ key: string; status: string }>(`
      SELECT r.key, v.status::text AS status FROM posting_rules r JOIN posting_rule_versions v ON v.posting_rule_id = r.id ORDER BY r.key`);
    for (let n = 1; n <= 30; n++)
      expect(rules.rows.map((r) => r.key)).toContain(`P${String(n).padStart(2, '0')}`);
    expect(new Set(rules.rows.map((r) => r.status))).toEqual(new Set(['approved']));
  });

  it('seeds the D-020 payment schedule templates and the payment flags off (B3.2)', async () => {
    const { rows } = await db.client.query<{
      key: string;
      status: string;
      instalments: string;
      pct: string;
    }>(`
      SELECT t.key, v.status::text AS status, count(i.id) AS instalments, sum(i.pct)::text AS pct
        FROM payment_schedule_templates t
        JOIN payment_schedule_template_versions v ON v.template_id = t.id
        JOIN payment_schedule_template_instalments i ON i.template_version_id = v.id
       GROUP BY t.key, v.status ORDER BY t.key`);
    expect(rows).toEqual([
      { key: 'credit_term', status: 'approved', instalments: '1', pct: '100.0000' },
      { key: 'deposit_50_before_shipping_50', status: 'approved', instalments: '2', pct: '100.0000' },
      { key: 'full_upfront', status: 'approved', instalments: '1', pct: '100.0000' },
    ]);
    expect(await count("feature_flags WHERE key LIKE 'payments.%' AND enabled")).toBe(0);
    expect(await count("feature_flags WHERE key LIKE 'payments.%'")).toBe(5);
  });

  it('seeds approved standard and mockup milestone routes for every produced product type (B4.2, D-075)', async () => {
    expect(await count("milestone_routes WHERE variant = 'standard'")).toBe(13);
    expect(await count("milestone_routes WHERE variant = 'mockup'")).toBe(13);
    expect(await count("milestone_route_versions WHERE status = 'approved'")).toBe(26);
    const { rows } = await db.client.query<{ key: string }>(`
      SELECT s.key FROM milestone_route_steps s
        JOIN milestone_route_versions v ON v.id = s.version_id
        JOIN milestone_routes r ON r.id = v.route_id
        JOIN product_types t ON t.id = r.product_type_id
       WHERE t.code = 'folding_carton' AND r.variant = 'standard' ORDER BY s.seq`);
    expect(rows.map((r) => r.key)).toEqual([
      'job_received',
      'prepress_ready',
      'materials_ready',
      'printing',
      'finishing',
      'die_cut',
      'gluing',
      'qc',
      'packing',
      'ready_to_ship',
    ]);
  });

  it('seeds the drawing engine flag off until @getpack/dieline is published (B4.1)', async () => {
    expect(await count("feature_flags WHERE key = 'drawing.engine' AND NOT enabled")).toBe(1);
  });

  it('seeds the order cancel reasons lookup (B3.1)', async () => {
    expect(await count('order_cancel_reasons')).toBe(7);
    expect(await count("order_cancel_reasons WHERE code = 'payment_expired' AND applies_to = 'system'")).toBe(
      1,
    );
  });

  it('keeps the issuing entity data in entity-scoped settings, not in code (D-092)', async () => {
    const { rows } = await db.client.query<{ key: string }>(
      "SELECT key FROM settings WHERE scope_type = 'entity' ORDER BY key",
    );
    expect(rows.map((r) => r.key)).toEqual([
      'entity.address_th',
      'entity.branch_code',
      'entity.display_name',
      'entity.legal_name_en',
      'entity.legal_name_th',
      'entity.phone',
      'entity.return_address',
      'entity.tax_id',
    ]);
  });

  it('approves every policy version with its steps; discount memos have one step per tier (D-162)', async () => {
    const { rows } = await db.client.query<{ key: string; status: string; steps: string }>(`
      SELECT p.key, v.status::text AS status, count(s.id) AS steps
        FROM approval_policies p
        JOIN approval_policy_versions v ON v.policy_id = p.id
        JOIN approval_steps s ON s.policy_version_id = v.id
       GROUP BY p.key, v.status`);
    expect(rows).toHaveLength(APPROVAL_POLICIES.length);
    expect(rows.every((r) => r.status === 'approved')).toBe(true);
    expect(rows.find((r) => r.key === 'discount_memo')?.steps).toBe('3');
  });

  it('grants each fake staff user its role, on the platform scope', async () => {
    const { rows } = await db.client.query<{ email: string; role: string; scope: string }>(`
      SELECT u.email, r.key AS role, ur.scope_type::text AS scope
        FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
       WHERE u.kind = 'staff'`);
    expect(rows).toHaveLength(16);
    for (const row of rows) {
      expect(row.email).toBe(`${row.role.replaceAll('_', '-')}@example.invalid`);
      expect(row.scope).toBe('platform');
    }
  });

  it('seeds the empty national calendar and consent purposes without texts (D-161, D-005)', async () => {
    expect(await count("business_calendars WHERE code = 'th_public'")).toBe(1);
    expect(await count('business_calendar_days')).toBe(0);
    expect(await count('consent_purposes')).toBe(7);
    expect(await count('consent_purpose_versions')).toBe(0);
  });

  it('adds a second entity without taking over the default', async () => {
    await seedReference(prisma, { code: 'OTHER', displayName: 'Other entity (fake)' });
    const { rows } = await db.client.query<{ code: string; is_default: boolean }>(
      'SELECT code, is_default FROM entities ORDER BY code',
    );
    expect(rows).toEqual([
      { code: 'DEV', is_default: true },
      { code: 'OTHER', is_default: false },
    ]);
  });
});
