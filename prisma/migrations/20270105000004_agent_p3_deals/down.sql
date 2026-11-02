-- Rollback of 20270105000004_agent_p3_deals (manual). Deal registrations are dropped: commissions accrued afterwards
-- use the plan version in force when the group was placed again (rates already accrued stay as recorded).
ALTER TABLE sales_agent_quotes DROP COLUMN IF EXISTS deal_registration_id;
DROP TABLE IF EXISTS sales_agent_deal_registrations;
DROP TYPE IF EXISTS sales_agent_deal_origin;
DROP TYPE IF EXISTS sales_agent_deal_status;
DROP TYPE IF EXISTS sales_agent_deal_scope;
