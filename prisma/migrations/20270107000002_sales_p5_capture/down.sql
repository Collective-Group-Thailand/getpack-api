-- Rollback of 20270107000002_sales_p5_capture (manual; before 20270107000001's down.sql). Downloads taken without
-- sign-in are deleted (they have no account to keep them on); the capture columns are dropped.
ALTER TABLE sales_inbound_leads DROP CONSTRAINT IF EXISTS fk_sales_inbound_leads__consent_record_id;
ALTER TABLE sales_inbound_leads DROP CONSTRAINT IF EXISTS fk_sales_inbound_leads__design_document_id;
ALTER TABLE sales_inbound_leads DROP CONSTRAINT IF EXISTS fk_sales_inbound_leads__capture_user_id;
ALTER TABLE sales_inbound_leads DROP CONSTRAINT IF EXISTS ck_sales_inbound_leads__signal_count;
DROP INDEX IF EXISTS ix_sales_inbound_leads__consent_record_id;
DROP INDEX IF EXISTS ix_sales_inbound_leads__capture_user_id__source;
DROP INDEX IF EXISTS ux_sales_inbound_leads__design_document_id;
ALTER TABLE sales_inbound_leads
  DROP COLUMN IF EXISTS capture_user_id,
  DROP COLUMN IF EXISTS consent_basis,
  DROP COLUMN IF EXISTS consent_record_id,
  DROP COLUMN IF EXISTS design_document_id,
  DROP COLUMN IF EXISTS last_signal_at,
  DROP COLUMN IF EXISTS signal_count;
DROP TYPE IF EXISTS sales_inbound_consent_basis;

DROP INDEX IF EXISTS ix_dieline_downloads__device_hash;
ALTER TABLE dieline_downloads DROP CONSTRAINT IF EXISTS ck_dieline_downloads__user_or_device;
DELETE FROM dieline_downloads WHERE user_id IS NULL;
ALTER TABLE dieline_downloads DROP COLUMN IF EXISTS device_hash;
ALTER TABLE dieline_downloads ALTER COLUMN user_id SET NOT NULL;
