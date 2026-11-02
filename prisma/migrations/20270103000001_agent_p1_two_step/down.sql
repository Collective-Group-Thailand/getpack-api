-- Rollback of 20270103000001_agent_p1_two_step (manual). Only while every application still carries the step-1 tax
-- and bank fields (no two-step application yet): NOT NULL would fail on rows that do not.
DROP TABLE IF EXISTS sales_agent_payout_profiles;
ALTER TABLE sales_agent_statements DROP COLUMN IF EXISTS flags;
ALTER TABLE sales_agent_applications
  DROP COLUMN IF EXISTS email, DROP COLUMN IF EXISTS line_id, DROP COLUMN IF EXISTS phone,
  DROP COLUMN IF EXISTS sales_channels,
  ALTER COLUMN tax_id SET NOT NULL, ALTER COLUMN address SET NOT NULL, ALTER COLUMN postcode SET NOT NULL,
  ALTER COLUMN id_document_file_id SET NOT NULL, ALTER COLUMN bank_code SET NOT NULL,
  ALTER COLUMN bank_account_name SET NOT NULL, ALTER COLUMN bank_account_no_enc SET NOT NULL,
  ALTER COLUMN bank_account_no_last4 SET NOT NULL;
DROP TYPE IF EXISTS sales_agent_payout_profile_status;
DROP TYPE IF EXISTS sales_agent_sales_channel;
