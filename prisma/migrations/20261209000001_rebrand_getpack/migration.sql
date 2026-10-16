-- D-425: the platform is renamed from Packio to getpack (domain getpack.co).
--
-- 1. Enum values that carried the old name are renamed in place (rows keep their value; checks and
--    triggers compare enum values by identity, so they follow the rename).
-- 2. The text-valued production material origin `packio_spec` becomes `getpack_spec`.
-- 3. The ledger period guards read the session settings `getpack.post_soft_closed` /
--    `getpack.erp_post_soft_closed` (set by the posting services).
-- 4. Reference and configuration rows that name the brand (permission and setting descriptions, setting
--    values, notification templates, feature flags, agreement templates, the factory ledger's chart, rules
--    and account map) are rewritten. Approved versions are immutable by trigger; their guard is lifted for
--    this one statement only — a pre-launch rename of the same text, not a new version (D-425).
--    History is left as it was written: audit and activity logs, domain events, idempotent responses,
--    posted journal entries, file objects, and staff-authored content (articles, campaigns).

-- 1. Enum values --------------------------------------------------------------------------------------------
ALTER TYPE "proposal_direction" RENAME VALUE 'factory_to_packio' TO 'factory_to_getpack';
ALTER TYPE "proposal_direction" RENAME VALUE 'packio_to_factory' TO 'getpack_to_factory';
ALTER TYPE "claim_liability" RENAME VALUE 'packio' TO 'getpack';
ALTER TYPE "erp_production_source" RENAME VALUE 'packio_job' TO 'getpack_job';
ALTER TYPE "erp_lead_source" RENAME VALUE 'packio' TO 'getpack';

-- 2. Production material origin ----------------------------------------------------------------------------
ALTER TABLE "erp_production_materials" DROP CONSTRAINT ck_erp_production_materials__origin;
UPDATE "erp_production_materials" SET origin = 'getpack_spec' WHERE origin = 'packio_spec';
ALTER TABLE "erp_production_materials"
  ADD CONSTRAINT ck_erp_production_materials__origin CHECK (origin IN ('recipe', 'getpack_spec', 'manual'));

-- 3. Ledger period guards ----------------------------------------------------------------------------------
-- A posted entry lands in an open period of its entity; a soft-closed period accepts postings
-- only when the posting session set `getpack.post_soft_closed` (permission `ledger.post_soft_closed`).
CREATE OR REPLACE FUNCTION tg_journal_entries__period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p fiscal_periods%ROWTYPE;
BEGIN
  IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
  SELECT * INTO p FROM fiscal_periods WHERE id = NEW.fiscal_period_id;
  IF p.entity_id <> NEW.entity_id OR NEW.entry_date NOT BETWEEN p.start_date AND p.end_date THEN
    RAISE EXCEPTION 'entry date % is outside fiscal period %', NEW.entry_date, p.id USING ERRCODE = 'check_violation';
  END IF;
  IF p.status = 'open' OR (p.status = 'soft_closed' AND current_setting('getpack.post_soft_closed', true) = 'on') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ledger.period_closed: fiscal period % is %', p.id, p.status USING ERRCODE = 'restrict_violation';
END
$$;

-- The factory ledger's equivalent: `getpack.erp_post_soft_closed` (permission `factory_ledger.close`).
CREATE OR REPLACE FUNCTION tg_erp_gl_journal_entries__period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p erp_gl_periods%ROWTYPE;
BEGIN
  IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
  SELECT * INTO p FROM erp_gl_periods WHERE id = NEW.period_id;
  IF p.factory_id <> NEW.factory_id OR NEW.entry_date NOT BETWEEN p.start_date AND p.end_date THEN
    RAISE EXCEPTION 'entry date % is outside factory fiscal period %', NEW.entry_date, p.id USING ERRCODE = 'check_violation';
  END IF;
  IF p.status = 'open' OR (p.status = 'soft_closed' AND current_setting('getpack.erp_post_soft_closed', true) = 'on') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'erp.ledger_period_closed: factory fiscal period % is %', p.id, p.status USING ERRCODE = 'restrict_violation';
END
$$;

-- 4. Reference and configuration rows ----------------------------------------------------------------------
-- Same rules as the source rename: account-map keys and the engine package first, then the domain, then the
-- brand (a lower-case wordmark in prose).
CREATE FUNCTION rebrand_getpack(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(replace(replace(replace(replace(replace(t,
    'receivablesPackio', 'receivablesGetpack'),
    'salesPackio', 'salesGetpack'),
    'packio.co.th', 'getpack.co'),
    'X-Packio-', 'X-Getpack-'),
    '@packio/', '@getpack/'),
    'Packio', 'getpack'),
    'packio', 'getpack')
$$;

UPDATE "permissions" SET description = rebrand_getpack(description) WHERE description ILIKE '%packio%';
UPDATE "settings" SET description = rebrand_getpack(description) WHERE description ILIKE '%packio%';
UPDATE "feature_flags" SET description = rebrand_getpack(description) WHERE description ILIKE '%packio%';
UPDATE "notification_templates" SET description = rebrand_getpack(description) WHERE description ILIKE '%packio%';
UPDATE "notification_template_versions"
  SET subject = rebrand_getpack(subject), body = rebrand_getpack(body)
  WHERE subject ILIKE '%packio%' OR body ILIKE '%packio%';
UPDATE "approval_requests" SET payload_snapshot = rebrand_getpack(payload_snapshot::text)::jsonb
  WHERE payload_snapshot::text ILIKE '%packio%';

ALTER TABLE "setting_versions" DISABLE TRIGGER tg_setting_versions__immutable;
UPDATE "setting_versions" SET value = rebrand_getpack(value::text)::jsonb WHERE value::text ILIKE '%packio%';
ALTER TABLE "setting_versions" ENABLE TRIGGER tg_setting_versions__immutable;

ALTER TABLE "agreement_template_versions" DISABLE TRIGGER tg_agreement_template_versions__immutable;
UPDATE "agreement_template_versions"
  SET text_th = rebrand_getpack(text_th), text_en = rebrand_getpack(text_en)
  WHERE text_th ILIKE '%packio%' OR text_en ILIKE '%packio%';
ALTER TABLE "agreement_template_versions" ENABLE TRIGGER tg_agreement_template_versions__immutable;

UPDATE "erp_gl_accounts" SET name_th = rebrand_getpack(name_th), name_en = rebrand_getpack(name_en)
  WHERE name_th ILIKE '%packio%' OR name_en ILIKE '%packio%';
UPDATE "erp_gl_posting_rules" SET name = rebrand_getpack(name), description = rebrand_getpack(description)
  WHERE name ILIKE '%packio%' OR description ILIKE '%packio%';
UPDATE "erp_gl_settings" SET method_accounts = rebrand_getpack(method_accounts::text)::jsonb
  WHERE method_accounts::text ILIKE '%packio%';
ALTER TABLE "erp_gl_posting_rule_versions" DISABLE TRIGGER tg_erp_gl_posting_rule_versions__immutable;
UPDATE "erp_gl_posting_rule_versions" SET template = rebrand_getpack(template::text)::jsonb
  WHERE template::text ILIKE '%packio%';
ALTER TABLE "erp_gl_posting_rule_versions" ENABLE TRIGGER tg_erp_gl_posting_rule_versions__immutable;

DROP FUNCTION rebrand_getpack(text);
