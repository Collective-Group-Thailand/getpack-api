import { type MigratedDatabase, startMigratedDatabase, stopMigratedDatabase } from '../support/database';

/**
 * What Prisma cannot express lives in hand-written migration SQL (docs/schema-design.md §1.5).
 * A regenerated migration could drop it silently, so the catalogue is asserted here.
 */

const CHECKS = [
  'ck_activity_logs__actor',
  'ck_approval_delegations__distinct',
  'ck_approval_delegations__window',
  'ck_approval_policies__key',
  'ck_approval_policy_versions__decided',
  'ck_approval_policy_versions__reason',
  'ck_approval_policy_versions__version_no',
  'ck_approval_request_steps__quorum',
  'ck_approval_request_steps__step_no',
  'ck_approval_requests__amount',
  'ck_approval_requests__decided',
  'ck_approval_requests__pct',
  'ck_approval_steps__quorum',
  'ck_approval_steps__sla_minutes',
  'ck_approval_steps__step_no',
  'ck_attachments__role',
  'ck_attachments__sort',
  'ck_audit_logs__actor',
  'ck_auth_sessions__expiry',
  'ck_auth_sessions__octets',
  'ck_auth_sessions__revoked',
  'ck_business_calendar_days__observance',
  'ck_business_calendars__factory',
  'ck_business_calendars__not_own_base',
  'ck_business_calendars__weekend_days',
  'ck_consent_purpose_versions__decided',
  'ck_consent_purpose_versions__reason',
  'ck_consent_purpose_versions__version_no',
  'ck_consent_purposes__key',
  'ck_consent_records__subject',
  'ck_device_pins__failed_attempts',
  'ck_domain_events__actor',
  'ck_entities__base_currency',
  'ck_entities__code',
  'ck_entities__fiscal_year_start_month',
  'ck_file_objects__dimensions',
  'ck_file_objects__sha256',
  'ck_file_objects__size',
  'ck_idempotency_keys__completed',
  'ck_idempotency_keys__sha256',
  'ck_notification_preferences__transactional_email',
  'ck_notification_template_versions__published',
  'ck_notifications__recipient',
  'ck_otp_challenges__attempts',
  'ck_otp_challenges__octets',
  'ck_otp_challenges__phone_e164',
  'ck_outbox_messages__attempts',
  'ck_password_reset_tokens__octets',
  'ck_permissions__key',
  'ck_roles__key',
  'ck_setting_versions__decided',
  'ck_setting_versions__reason',
  'ck_setting_versions__version_no',
  'ck_settings__decision_refs',
  'ck_settings__key',
  'ck_settings__scope',
  'ck_sod_rules__key',
  'ck_sod_rules__shape',
  'ck_user_roles__reason',
  'ck_user_roles__scope',
  'ck_user_roles__window',
  'ck_users__customer_passwordless',
  'ck_users__failed_login_count',
  'ck_users__phone_e164',
];

const TRIGGERS = [
  'tg_activity_logs__append_only',
  'tg_approval_actions__append_only',
  'tg_approval_actions__maker_checker',
  'tg_approval_policy_versions__immutable',
  'tg_approval_steps__follow_version',
  'tg_audit_logs__append_only',
  'tg_consent_purpose_versions__immutable',
  'tg_consent_records__append_only',
  'tg_consent_records__match_purpose',
  'tg_domain_events__append_only',
  'tg_setting_versions__immutable',
  'tg_user_roles__match_role',
];

/** Expression (hand-written) and partial (Prisma preview) indexes. */
const INDEXES = [
  'ux_settings__key__scope',
  'ux_notification_routes__matrix',
  'ux_notifications__event__recipient__channel',
  'ux_user_roles__active',
  'ux_entities__is_default',
  'ix_setting_versions__resolution',
  'ix_approval_policy_versions__resolution',
  'ux_approval_requests__one_pending_per_subject',
  'ux_approval_actions__one_approval_per_person',
  'ix_outbox_messages__due',
  'ux_notification_template_versions__one_published',
  'ux_users__kind__email',
  'ux_users__kind__phone',
  'ux_user_identities__provider__subject',
  'ux_device_pins__user_id__device_id',
  'ix_consent_purpose_versions__resolution',
];

const PARTIAL_INDEXES = INDEXES.filter(
  (name) =>
    !name.startsWith('ux_settings') &&
    name !== 'ux_notification_routes__matrix' &&
    name !== 'ux_notifications__event__recipient__channel',
);

const EXTENSIONS = ['vector', 'pgcrypto', 'pg_trgm', 'citext'];

describe('schema catalogue after migrations (PostgreSQL 18)', () => {
  let db: MigratedDatabase;

  beforeAll(async () => {
    db = await startMigratedDatabase();
  });

  afterAll(async () => {
    await stopMigratedDatabase(db);
  });

  async function names(sql: string): Promise<string[]> {
    const { rows } = await db.client.query<{ name: string }>(sql);
    return rows.map((row) => row.name);
  }

  it('installs every extension', async () => {
    const installed = await names('SELECT extname AS name FROM pg_extension');
    expect(installed).toEqual(expect.arrayContaining(EXTENSIONS));
  });

  it('keeps every hand-written check constraint', async () => {
    const found = await names("SELECT DISTINCT conname AS name FROM pg_constraint WHERE contype = 'c'");
    expect(CHECKS.filter((name) => !found.includes(name))).toEqual([]);
  });

  it('keeps every trigger', async () => {
    const found = await names('SELECT DISTINCT tgname AS name FROM pg_trigger WHERE NOT tgisinternal');
    expect(TRIGGERS.filter((name) => !found.includes(name))).toEqual([]);
  });

  it('keeps expression and partial indexes, partial ones with a predicate', async () => {
    const found = await names("SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public'");
    expect(INDEXES.filter((name) => !found.includes(name))).toEqual([]);

    const partial = await names(
      'SELECT c.relname AS name FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE i.indpred IS NOT NULL',
    );
    expect(PARTIAL_INDEXES.filter((name) => !partial.includes(name))).toEqual([]);
  });

  it('uses identity columns, never serial sequences, for bigint ids', async () => {
    const serial = await names(`
      SELECT table_name AS name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'id' AND data_type = 'bigint'
         AND is_identity = 'NO' AND table_name NOT IN ('_prisma_migrations')`);
    expect(serial).toEqual([]);
  });

  it('defaults public ids to uuidv7()', async () => {
    const wrong = await names(`
      SELECT table_name AS name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'public_id'
         AND coalesce(column_default, '') NOT LIKE 'uuidv7()%'`);
    expect(wrong).toEqual([]);
  });

  it('partitions audit and activity logs monthly in schema `partitions`, with a default partition', async () => {
    for (const parent of ['audit_logs', 'activity_logs']) {
      const children = await names(`
        SELECT n.nspname || '.' || c.relname AS name
          FROM pg_inherits i
          JOIN pg_class c ON c.oid = i.inhrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE i.inhparent = '${parent}'::regclass`);
      expect(children).toEqual(
        expect.arrayContaining([
          `partitions.${parent}_default`,
          `partitions.${parent}_2026_09`,
          `partitions.${parent}_2027_09`,
        ]),
      );
      expect(children).toHaveLength(14);
    }
  });

  it('creates monthly partitions idempotently', async () => {
    await db.client.query("SELECT ensure_monthly_partitions('audit_logs', DATE '2027-09-01', 3)");
    await db.client.query("SELECT ensure_monthly_partitions('audit_logs', DATE '2027-09-01', 3)");
    const children = await names(
      "SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE i.inhparent = 'audit_logs'::regclass",
    );
    expect(children).toEqual(expect.arrayContaining(['audit_logs_2027_10', 'audit_logs_2027_11']));
    expect(new Set(children).size).toBe(children.length);
  });
});
