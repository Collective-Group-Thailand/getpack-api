-- Rollback of 20270105000001_agent_p3_pipeline (manual). The pipeline fields, timelines and imports are dropped (leads
-- keep their D-417 registration and protection); the notification event follow_up_due is removed from the enum (its
-- preference rows first).
DROP TABLE IF EXISTS sales_agent_lead_activities;
DROP TABLE IF EXISTS sales_agent_lead_imports;
DROP INDEX IF EXISTS ix_sales_agent_leads__agent_id__stage;
DROP INDEX IF EXISTS ix_sales_agent_leads__next_follow_up_at__due;
ALTER TABLE sales_agent_leads
  DROP COLUMN IF EXISTS expected_value, DROP COLUMN IF EXISTS follow_up_reminded_at, DROP COLUMN IF EXISTS industry,
  DROP COLUMN IF EXISTS line_id, DROP COLUMN IF EXISTS lost_note, DROP COLUMN IF EXISTS lost_reason,
  DROP COLUMN IF EXISTS next_follow_up_at, DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS stage,
  DROP COLUMN IF EXISTS stage_changed_at, DROP COLUMN IF EXISTS tags, DROP COLUMN IF EXISTS won_at;
DROP TYPE IF EXISTS sales_agent_lead_stage;
DROP TYPE IF EXISTS sales_agent_lead_lost_reason;
DROP TYPE IF EXISTS sales_agent_lead_source;
DROP TYPE IF EXISTS sales_agent_lead_activity_kind;
DROP TYPE IF EXISTS sales_agent_lead_import_status;
DELETE FROM sales_agent_notification_preferences WHERE event = 'follow_up_due';
ALTER TYPE sales_agent_notification_event RENAME TO sales_agent_notification_event_p3;
CREATE TYPE sales_agent_notification_event AS ENUM ('lead_converted', 'lead_protection_expiring', 'commission_earned', 'statement_ready', 'payout_paid', 'payout_profile_needed');
ALTER TABLE sales_agent_notification_preferences
  ALTER COLUMN event TYPE sales_agent_notification_event USING event::text::sales_agent_notification_event;
DROP TYPE sales_agent_notification_event_p3;
