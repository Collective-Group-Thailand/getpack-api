import {
  inRollback,
  type MigratedDatabase,
  SQLSTATE,
  sqlState,
  startMigratedDatabase,
  stopMigratedDatabase,
} from '../support/database';

/** Database-level rules of docs/schema-design.md §1.5, §2.1, ADR-0004, ADR-0005, ADR-0006. */
describe('schema behaviour (PostgreSQL 18)', () => {
  let db: MigratedDatabase;

  beforeAll(async () => {
    db = await startMigratedDatabase();
  });

  afterAll(async () => {
    await stopMigratedDatabase(db);
  });

  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await db.client.query<T>(sql, params)).rows;

  const id = async (sql: string, params: unknown[] = []): Promise<string> => {
    const [row] = await q<{ id: string }>(`${sql} RETURNING id`, params);
    return row!.id;
  };

  let seq = 0;
  const user = (kind: 'customer' | 'staff' | 'partner') =>
    id("INSERT INTO users (kind, display_name, status, email) VALUES ($1, 'Test User', 'active', $2)", [
      kind,
      `user${++seq}@example.invalid`,
    ]);
  const role = (key: string, audience: string, scope: string) =>
    id(
      "INSERT INTO roles (key, audience, scope_type, name_th, name_en) VALUES ($1, $2, $3, 'ทดสอบ', 'Test')",
      [key, audience, scope],
    );
  const entity = () => id("INSERT INTO entities (code, display_name) VALUES ('TEST', 'Test entity')");

  async function approvalRequest(
    requester: string,
  ): Promise<{ request: string; policy: string; version: string }> {
    const policy = await id(
      "INSERT INTO approval_policies (key, subject_type, description) VALUES ('test_policy', 'test', 'Test')",
    );
    const version = await id(
      "INSERT INTO approval_policy_versions (policy_id, version_no, effective_from, reason) VALUES ($1, 1, now(), 'seed')",
      [policy],
    );
    const request = await id(
      `INSERT INTO approval_requests (entity_id, policy_id, policy_version_id, subject_type, subject_id, subject_public_id, requester_user_id, payload_snapshot)
       VALUES ($1, $2, $3, 'test', 1, gen_random_uuid(), $4, '{}')`,
      [await entity(), policy, version, requester],
    );
    return { request, policy, version };
  }

  describe('effective-dated settings (ADR-0005)', () => {
    const resolveAt = async (settingId: string, at: string) =>
      q<{ version_no: number }>(
        `SELECT version_no FROM setting_versions
          WHERE setting_id = $1 AND status = 'approved' AND effective_from <= $2
          ORDER BY effective_from DESC, version_no DESC LIMIT 1`,
        [settingId, at],
      );

    it('resolves at(t) at boundaries, before the first version, and with a superseding version', () =>
      inRollback(db.client, async () => {
        const setting = await id(
          "INSERT INTO settings (key, value_type, description, decision_refs, owner_role_key) VALUES ('test.value', 'integer', 'Test', '{D-000}', 'superadmin')",
        );
        const version = (no: number, from: string, status = 'approved') =>
          q(
            `INSERT INTO setting_versions (setting_id, version_no, effective_from, status, value, reason, decided_at)
             VALUES ($1, $2, $3, $4::config_version_status, '1', 'test', CASE WHEN $4::text IN ('approved', 'rejected') THEN now() END)`,
            [setting, no, from, status],
          );
        await version(1, '2026-01-01T00:00:00+07:00');
        await version(2, '2026-10-01T00:00:00+07:00');
        await version(3, '2026-09-15T00:00:00+07:00', 'draft');

        expect(await resolveAt(setting, '2025-12-31T23:59:59+07:00')).toEqual([]);
        expect(await resolveAt(setting, '2026-01-01T00:00:00+07:00')).toEqual([{ version_no: 1 }]);
        expect(await resolveAt(setting, '2026-09-30T23:59:59+07:00')).toEqual([{ version_no: 1 }]);
        expect(await resolveAt(setting, '2026-10-01T00:00:00+07:00')).toEqual([{ version_no: 2 }]);

        // A scheduled version is superseded by approving a newer one, never by editing it.
        await version(4, '2026-10-01T00:00:00+07:00');
        expect(await resolveAt(setting, '2026-10-01T00:00:00+07:00')).toEqual([{ version_no: 4 }]);
      }));

    it('refuses to change or delete a decided version, but lets drafts change', () =>
      inRollback(db.client, async () => {
        const setting = await id(
          "INSERT INTO settings (key, value_type, description, decision_refs, owner_role_key) VALUES ('test.value', 'integer', 'Test', '{D-000}', 'superadmin')",
        );
        const approved = await id(
          "INSERT INTO setting_versions (setting_id, version_no, effective_from, status, value, reason, decided_at) VALUES ($1, 1, now(), 'approved', '1', 'test', now())",
          [setting],
        );
        const draft = await id(
          "INSERT INTO setting_versions (setting_id, version_no, effective_from, value, reason) VALUES ($1, 2, now(), '2', 'test')",
          [setting],
        );
        expect(
          await sqlState(db.client, "UPDATE setting_versions SET value = '9' WHERE id = $1", [approved]),
        ).toBe(SQLSTATE.restrictViolation);
        expect(await sqlState(db.client, 'DELETE FROM setting_versions WHERE id = $1', [approved])).toBe(
          SQLSTATE.restrictViolation,
        );
        expect(
          await sqlState(db.client, "UPDATE setting_versions SET value = '3' WHERE id = $1", [draft]),
        ).toBeNull();
      }));

    it('keys a setting by (key, scope) and requires a decision reference', () =>
      inRollback(db.client, async () => {
        const insert = (key: string, refs: string) =>
          sqlState(
            db.client,
            `INSERT INTO settings (key, value_type, description, decision_refs, owner_role_key) VALUES ($1, 'integer', 'Test', $2, 'superadmin')`,
            [key, refs],
          );
        expect(await insert('test.once', '{D-000}')).toBeNull();
        expect(await insert('test.once', '{D-000}')).toBe(SQLSTATE.uniqueViolation);
        expect(await insert('test.no_refs', '{}')).toBe(SQLSTATE.checkViolation);
      }));
  });

  describe('approval engine (ADR-0006)', () => {
    it('blocks self-approval, including on behalf of the requester, and double approval', () =>
      inRollback(db.client, async () => {
        const requester = await user('staff');
        const approver = await user('staff');
        const { request } = await approvalRequest(requester);
        const approve = (actor: string, onBehalfOf: string | null = null) =>
          sqlState(
            db.client,
            "INSERT INTO approval_actions (request_id, action, actor_user_id, on_behalf_of_user_id) VALUES ($1, 'approve', $2, $3)",
            [request, actor, onBehalfOf],
          );
        expect(await approve(requester)).toBe(SQLSTATE.checkViolation);
        expect(await approve(approver, requester)).toBe(SQLSTATE.checkViolation);
        expect(await approve(approver)).toBeNull();
        expect(await approve(approver)).toBe(SQLSTATE.uniqueViolation);
        expect(
          await sqlState(db.client, 'DELETE FROM approval_actions WHERE request_id = $1', [request]),
        ).toBe(SQLSTATE.restrictViolation);
      }));

    it('allows one pending request per subject and policy', () =>
      inRollback(db.client, async () => {
        const requester = await user('staff');
        const { policy, version } = await approvalRequest(requester);
        const [entityRow] = await q<{ id: string }>('SELECT id FROM entities LIMIT 1');
        const second = await sqlState(
          db.client,
          `INSERT INTO approval_requests (entity_id, policy_id, policy_version_id, subject_type, subject_id, subject_public_id, requester_user_id, payload_snapshot)
           VALUES ($1, $2, $3, 'test', 1, gen_random_uuid(), $4, '{}')`,
          [entityRow!.id, policy, version, requester],
        );
        expect(second).toBe(SQLSTATE.uniqueViolation);
      }));

    it('freezes the steps of a decided policy version', () =>
      inRollback(db.client, async () => {
        const approverRole = await role('test_approver', 'staff', 'platform');
        const { version } = await approvalRequest(await user('staff'));
        const addStep = (no: number) =>
          sqlState(
            db.client,
            "INSERT INTO approval_steps (policy_version_id, step_no, name, approver_role_id) VALUES ($1, $2, 'Step', $3)",
            [version, no, approverRole],
          );
        expect(await addStep(1)).toBeNull();
        await q("UPDATE approval_policy_versions SET status = 'approved', decided_at = now() WHERE id = $1", [
          version,
        ]);
        expect(await addStep(2)).toBe(SQLSTATE.restrictViolation);
      }));
  });

  describe('append-only logs and events', () => {
    it('refuses updates and deletes of domain events and audit logs', () =>
      inRollback(db.client, async () => {
        const [event] = await q<{ id: string }>(
          "INSERT INTO domain_events (type, aggregate_type, aggregate_id, actor_type, correlation_id, payload) VALUES ('test.happened', 'test', gen_random_uuid(), 'system', gen_random_uuid(), '{}') RETURNING id",
        );
        expect(
          await sqlState(db.client, "UPDATE domain_events SET type = 'x' WHERE id = $1", [event!.id]),
        ).toBe(SQLSTATE.restrictViolation);
        await q(
          "INSERT INTO audit_logs (actor_type, category, action, outcome) VALUES ('system', 'security', 'test.action', 'success')",
        );
        expect(await sqlState(db.client, 'DELETE FROM audit_logs')).toBe(SQLSTATE.restrictViolation);
      }));

    it('checks that the actor columns match the actor type', () =>
      inRollback(db.client, async () => {
        const state = await sqlState(
          db.client,
          "INSERT INTO audit_logs (actor_type, category, action, outcome) VALUES ('user', 'security', 'test.action', 'success')",
        );
        expect(state).toBe(SQLSTATE.checkViolation);
      }));

    it('routes a log row to its monthly partition (UTC month)', () =>
      inRollback(db.client, async () => {
        const [row] = await q<{ partition: string }>(
          `INSERT INTO audit_logs (occurred_at, actor_type, category, action, outcome)
           VALUES ('2026-10-15T12:00:00Z', 'system', 'security', 'test.action', 'success')
           RETURNING tableoid::regclass::text AS partition`,
        );
        expect(row!.partition).toBe('partitions.audit_logs_2026_10');
      }));
  });

  describe('IAM (ADR-0004, D-140)', () => {
    it('keeps audiences apart and scopes consistent on role grants', () =>
      inRollback(db.client, async () => {
        const staffRole = await role('test_staff', 'staff', 'platform');
        const factoryRole = await role('test_factory', 'partner', 'factory');
        const customer = await user('customer');
        const staff = await user('staff');
        const partner = await user('partner');
        const grant = (userId: string, roleId: string, scope: string, scopeId: number | null) =>
          sqlState(
            db.client,
            "INSERT INTO user_roles (user_id, role_id, scope_type, scope_id, reason) VALUES ($1, $2, $3, $4, 'test')",
            [userId, roleId, scope, scopeId],
          );
        expect(await grant(customer, staffRole, 'platform', null)).toBe(SQLSTATE.checkViolation);
        expect(await grant(staff, staffRole, 'factory', 1)).toBe(SQLSTATE.checkViolation);
        expect(await grant(staff, staffRole, 'platform', 7)).toBe(SQLSTATE.checkViolation);
        expect(await grant(staff, staffRole, 'platform', null)).toBeNull();
        expect(await grant(staff, staffRole, 'platform', null)).toBe(SQLSTATE.uniqueViolation);
        expect(await grant(partner, factoryRole, 'factory', 1)).toBeNull();
        expect(await grant(partner, factoryRole, 'factory', 2)).toBeNull();

        await q('UPDATE user_roles SET revoked_at = now() WHERE user_id = $1', [staff]);
        expect(await grant(staff, staffRole, 'platform', null)).toBeNull();
      }));

    it('keeps customers passwordless, phones in E.164, and emails unique per audience until anonymised', () =>
      inRollback(db.client, async () => {
        const insert = (
          kind: string,
          email: string | null,
          phone: string | null,
          passwordHash: string | null,
        ) =>
          sqlState(
            db.client,
            "INSERT INTO users (kind, display_name, email, phone, password_hash) VALUES ($1, 'Test', $2, $3, $4)",
            [kind, email, phone, passwordHash],
          );
        expect(await insert('customer', null, null, 'argon2id$fake')).toBe(SQLSTATE.checkViolation);
        expect(await insert('customer', null, '0812345678', null)).toBe(SQLSTATE.checkViolation);
        expect(await insert('customer', 'same@example.invalid', '+66812345678', null)).toBeNull();
        expect(await insert('customer', 'SAME@example.invalid', null, null)).toBe(SQLSTATE.uniqueViolation);
        expect(await insert('staff', 'same@example.invalid', null, 'argon2id$fake')).toBeNull();

        await q(
          "UPDATE users SET anonymised_at = now() WHERE kind = 'customer' AND email = 'same@example.invalid'",
        );
        expect(await insert('customer', 'same@example.invalid', null, null)).toBeNull();
      }));

    it('enforces the shape of SoD rules', () =>
      inRollback(db.client, async () => {
        const a = await role('test_a', 'staff', 'platform');
        const rule = (
          kind: string,
          roleA: string | null,
          roleB: string | null,
          actionA: string | null,
          match: string | null,
        ) =>
          sqlState(
            db.client,
            `INSERT INTO sod_rules (key, kind, role_a_id, role_b_id, action_a, action_b, subject_match, description)
             VALUES ('test_rule_' || floor(random() * 1e9)::text, $1, $2, $3, $4, $4, $5, 'Test')`,
            [kind, roleA, roleB, actionA, match],
          );
        expect(await rule('role_pair', a, a, null, null)).toBe(SQLSTATE.checkViolation);
        expect(await rule('action_pair', null, null, 'payout_run.create', null)).toBe(
          SQLSTATE.checkViolation,
        );
        expect(await rule('action_pair', null, null, 'payout_run.create', 'same_subject')).toBeNull();
      }));
  });

  describe('notifications, consent, calendars', () => {
    it('refuses to disable transactional email (D-144)', () =>
      inRollback(db.client, async () => {
        const customer = await user('customer');
        const pref = (channel: string, category: string, enabled: boolean) =>
          sqlState(
            db.client,
            'INSERT INTO notification_preferences (user_id, channel, category, enabled) VALUES ($1, $2, $3, $4)',
            [customer, channel, category, enabled],
          );
        expect(await pref('email', 'transactional', false)).toBe(SQLSTATE.checkViolation);
        expect(await pref('email', 'marketing', false)).toBeNull();
        expect(await pref('sms', 'transactional', false)).toBeNull();
      }));

    it('checks that a consent record names the purpose of its version and is append-only', () =>
      inRollback(db.client, async () => {
        const purposeA = await id("INSERT INTO consent_purposes (key) VALUES ('test_a')");
        const purposeB = await id("INSERT INTO consent_purposes (key) VALUES ('test_b')");
        const versionA = await id(
          "INSERT INTO consent_purpose_versions (purpose_id, version_no, effective_from, status, text_th, text_en, reason, decided_at) VALUES ($1, 1, now(), 'approved', 'ข้อความ', 'Text', 'test', now())",
          [purposeA],
        );
        const record = (purpose: string) =>
          sqlState(
            db.client,
            "INSERT INTO consent_records (anonymous_id, purpose_id, purpose_version_id, granted, source) VALUES ('anon-1', $1, $2, true, 'web')",
            [purpose, versionA],
          );
        expect(await record(purposeB)).toBe(SQLSTATE.checkViolation);
        expect(await record(purposeA)).toBeNull();
        expect(await sqlState(db.client, 'UPDATE consent_records SET granted = false')).toBe(
          SQLSTATE.restrictViolation,
        );
      }));

    it('qualifies only holidays by observance and requires explicit weekend days (D-161)', () =>
      inRollback(db.client, async () => {
        expect(
          await sqlState(
            db.client,
            "INSERT INTO business_calendars (code, name, kind) VALUES ('test_cal', 'Test', 'national')",
          ),
        ).toBe(SQLSTATE.checkViolation);
        const calendar = await id(
          "INSERT INTO business_calendars (code, name, kind, weekend_days) VALUES ('test_cal', 'Test', 'national', '{0,6}')",
        );
        const day = (date: string, kind: string, observance: string) =>
          sqlState(
            db.client,
            "INSERT INTO business_calendar_days (calendar_id, day, kind, observance, name_th) VALUES ($1, $2, $3, $4, 'วันทดสอบ')",
            [calendar, date, kind, observance],
          );
        expect(await day('2026-05-13', 'holiday', 'government_only')).toBeNull();
        expect(await day('2026-05-14', 'closure', 'government_only')).toBe(SQLSTATE.checkViolation);
        expect(await day('2026-05-13', 'holiday', 'all')).toBe(SQLSTATE.uniqueViolation);
      }));
  });
});
