-- Rollback of 20270105000002_agent_p3_quotes (manual). The agent quote records are dropped (the quotes themselves stay,
-- owned by getpack, with their share links); the notification event quote_opened is removed from the enum (its
-- preference rows first).
DROP TABLE IF EXISTS sales_agent_quotes;
DROP TYPE IF EXISTS sales_agent_quote_status;
DELETE FROM sales_agent_notification_preferences WHERE event = 'quote_opened';
ALTER TYPE sales_agent_notification_event RENAME TO sales_agent_notification_event_p3q;
CREATE TYPE sales_agent_notification_event AS ENUM ('lead_converted', 'lead_protection_expiring', 'commission_earned', 'statement_ready', 'payout_paid', 'payout_profile_needed', 'follow_up_due');
ALTER TABLE sales_agent_notification_preferences
  ALTER COLUMN event TYPE sales_agent_notification_event USING event::text::sales_agent_notification_event;
DROP TYPE sales_agent_notification_event_p3q;
