-- Rollback of 20270107000003_sales_p5_scoring (manual). The scores are derived and are recomputed after a redeploy.
DROP INDEX IF EXISTS ix_sales_agent_leads__scored_at;
DROP INDEX IF EXISTS ix_sales_inbound_leads__score;
DROP INDEX IF EXISTS ix_sales_inbound_leads__scored_at;
ALTER TABLE sales_agent_leads DROP CONSTRAINT IF EXISTS ck_sales_agent_leads__score;
ALTER TABLE sales_inbound_leads DROP CONSTRAINT IF EXISTS ck_sales_inbound_leads__score;
ALTER TABLE sales_agent_leads
  DROP COLUMN IF EXISTS score,
  DROP COLUMN IF EXISTS score_reasons,
  DROP COLUMN IF EXISTS score_setting_version_id,
  DROP COLUMN IF EXISTS scored_at;
ALTER TABLE sales_inbound_leads
  DROP COLUMN IF EXISTS score,
  DROP COLUMN IF EXISTS score_reasons,
  DROP COLUMN IF EXISTS score_setting_version_id,
  DROP COLUMN IF EXISTS scored_at;
