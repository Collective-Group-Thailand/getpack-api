-- Rollback of 20270104000001_agent_p2_session_client (manual). Agent-zone sessions become indistinguishable from
-- storefront ones (they stay valid). Run 20270104000002 / 3 down.sql first if applied (they use the enum).
ALTER TABLE auth_sessions DROP COLUMN IF EXISTS client;
DROP TYPE IF EXISTS auth_client;
