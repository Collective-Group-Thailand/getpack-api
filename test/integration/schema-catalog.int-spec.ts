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

  // --- B2.1 catalogue & CMS
  'ck_article_categories__slug',
  'ck_articles__body_object',
  'ck_articles__published',
  'ck_articles__slug',
  'ck_banners__window',
  'ck_catalog_products__slug',
  'ck_faq_categories__code',
  'ck_flute_types__layers',
  'ck_geo_subdistricts__postcode',
  'ck_home_sections__config_object',
  'ck_home_sections__slug',
  'ck_materials__gsm',
  'ck_materials__micron',
  'ck_patterns__constraints_object',
  'ck_print_types__code',
  'ck_product_categories__code',
  'ck_product_categories__not_own_parent',
  'ck_product_types__code',
  'ck_product_types__instant_needs_calculator',
  'ck_semi_design_colours__hex',
  'ck_showcase_categories__slug',
  'ck_showcase_products__preset_object',
  'ck_showcase_products__slug',
  'ck_standard_sizes__calc_dimensions',
  'ck_standard_sizes__dimensions',
  'ck_stock_levels__on_hand',
  'ck_stock_levels__reserved',
  'ck_stock_movements__balance_after',
  'ck_stock_movements__quantity',
  'ck_stock_product_price_summaries__price',
  'ck_stock_products__measures',
  'ck_stock_products__min_order_qty',
  'ck_sub_patterns__seq',

  // --- B2.2 partners, vendors, zones
  'ck_agreement_acceptances__evidence',
  'ck_agreement_acceptances__signed_upload',
  'ck_agreement_template_versions__decided',
  'ck_agreement_template_versions__reason',
  'ck_agreement_template_versions__sha256',
  'ck_agreement_template_versions__version_no',
  'ck_agreement_templates__key',
  'ck_capacity_bookings__load',
  'ck_capacity_bookings__monday',
  'ck_factories__active',
  'ck_factories__branch_code',
  'ck_factories__code',
  'ck_factories__offboarded',
  'ck_factories__tax_id',
  'ck_factories__trial_jobs',
  'ck_factory_addresses__coordinates',
  'ck_factory_addresses__postcode',
  'ck_factory_capabilities__order_qty',
  'ck_factory_capabilities__sheet',
  'ck_factory_capacity_overrides__capacity',
  'ck_factory_capacity_overrides__monday',
  'ck_factory_capacity_overrides__reason',
  'ck_factory_capacity_versions__decided',
  'ck_factory_capacity_versions__reason',
  'ck_factory_capacity_versions__version_no',
  'ck_factory_capacity_versions__weekly',
  'ck_factory_contacts__phone_e164',
  'ck_factory_delivery_zones__extra_lead_days',
  'ck_factory_kyc_documents__dates',
  'ck_factory_kyc_documents__verified',
  'ck_factory_machines__size',
  'ck_factory_onboarding_steps__signed_off',
  'ck_factory_participation_versions__decided',
  'ck_factory_participation_versions__reason',
  'ck_factory_participation_versions__version_no',
  'ck_factory_payout_policy_versions__days',
  'ck_factory_payout_policy_versions__decided',
  'ck_factory_payout_policy_versions__pct',
  'ck_factory_payout_policy_versions__reason',
  'ck_factory_payout_policy_versions__version_no',
  'ck_factory_pricing_arrangement_versions__decided',
  'ck_factory_pricing_arrangement_versions__reason',
  'ck_factory_pricing_arrangement_versions__version_no',
  'ck_factory_status_history__reason',
  'ck_factory_tolerance_policy_versions__decided',
  'ck_factory_tolerance_policy_versions__pct',
  'ck_factory_tolerance_policy_versions__reason',
  'ck_factory_tolerance_policy_versions__version_no',
  'ck_index_points__period',
  'ck_index_points__value',
  'ck_index_series__code',
  'ck_index_series__material',
  'ck_price_impact_simulations__attempts',
  'ck_price_impact_simulations__done',
  'ck_price_impact_simulations__window',
  'ck_price_line_suggestions__basis_object',
  'ck_price_list_versions__assisted_signed_off',
  'ck_price_list_versions__decided',
  'ck_price_list_versions__line_count',
  'ck_price_list_versions__not_own_base',
  'ck_price_list_versions__rate_card_accepted',
  'ck_price_list_versions__reason',
  'ck_price_list_versions__sha256',
  'ck_price_list_versions__version_no',
  'ck_price_proposal_lines__counter',
  'ck_price_proposal_lines__line_key',
  'ck_price_proposal_lines__values',
  'ck_site_visits__checklist_object',
  'ck_vendor_bank_accounts__active',
  'ck_vendor_bank_accounts__hash',
  'ck_vendor_bank_accounts__last4',
  'ck_vendors__branch_code',
  'ck_vendors__payment_terms_days',
  'ck_vendors__postcode',
  'ck_vendors__tax_id',
  'ck_zone_postcodes__postcode',
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

  // --- B2.1 catalogue & CMS
  'tg_catalog_product_options__option_fk',
  'tg_stock_movements__append_only',
  'tg_videos__subject_fk',

  // --- B2.2 partners, vendors, zones
  'tg_agreement_acceptances__append_only',
  'tg_agreement_template_versions__immutable',
  'tg_factories__status',
  'tg_factory_capability_items__item_fk',
  'tg_factory_capacity_versions__immutable',
  'tg_factory_participation_versions__immutable',
  'tg_factory_payout_policy_versions__immutable',
  'tg_factory_pricing_arrangement_versions__immutable',
  'tg_factory_status_history__append_only',
  'tg_factory_tolerance_policy_versions__immutable',
  'tg_price_list_versions__immutable',
  'tg_vendor_bank_accounts__immutable',
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

  // --- B2.1 catalogue & CMS
  'ux_stock_product_price_summaries__product__zone',
  'ix_banners__position__sort',
  'ux_home_sections__slug',
  'ux_articles__slug',
  'ix_videos__subject',

  // --- B2.2 partners, vendors, zones
  'ux_factory_capabilities__factory__type__print_type',
  'ux_factory_tolerance_policies__factory__type',
  'ix_agreement_template_versions__resolution',
  'ix_factory_capacity_versions__resolution',
  'ix_factory_participation_versions__resolution',
  'ix_factory_payout_policy_versions__resolution',
  'ix_factory_pricing_arrangement_versions__resolution',
  'ix_factory_tolerance_policy_versions__resolution',
  'ix_price_impact_simulations__due',
  'ix_price_list_versions__resolution',
  'ux_factory_contacts__one_primary',
  'ux_vendor_bank_accounts__one_active',
];

const EXPRESSION_INDEXES = [
  'ux_settings__key__scope',
  'ux_notification_routes__matrix',
  'ux_notifications__event__recipient__channel',
  'ux_stock_product_price_summaries__product__zone',
  'ux_factory_capabilities__factory__type__print_type',
  'ux_factory_tolerance_policies__factory__type',
];

const PARTIAL_INDEXES = INDEXES.filter((name) => !EXPRESSION_INDEXES.includes(name));

/** Trigram indexes behind catalogue search (B2.1, `pg_trgm`). */
const TRIGRAM_INDEXES = [
  'ix_articles__title_th_trgm',
  'ix_catalog_products__name_en_trgm',
  'ix_catalog_products__name_th_trgm',
  'ix_materials__name_en_trgm',
  'ix_materials__name_th_trgm',
  'ix_showcase_products__name_th_trgm',
  'ix_stock_products__name_en_trgm',
  'ix_stock_products__name_th_trgm',
  'ix_stock_products__sku_trgm',
];

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

  it('backs catalogue search with GIN trigram indexes', async () => {
    const found = await names(
      "SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public' AND indexdef LIKE '%USING gin%gin_trgm_ops%'",
    );
    expect(TRIGRAM_INDEXES.filter((name) => !found.includes(name))).toEqual([]);
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
