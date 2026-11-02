-- Rollback of 20270104000003_agent_p2_notifications (manual). Agents' channel choices and the reminder markers are
-- dropped (every agent route becomes enabled again; a reminder may be sent once more); agent-zone push subscriptions
-- become ordinary ones.
DROP TABLE IF EXISTS sales_agent_notification_preferences;
ALTER TABLE web_push_subscriptions DROP COLUMN IF EXISTS client;
ALTER TABLE sales_agent_leads DROP COLUMN IF EXISTS protection_reminded_7d_at, DROP COLUMN IF EXISTS protection_reminded_1d_at;
DROP TYPE IF EXISTS sales_agent_notification_event;
