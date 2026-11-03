-- Rollback of 20270105000003_agent_p3_discounts (manual). Discount requests, their options and acceptance evidence
-- are dropped (no commission has used them before Phase 4 approvals).
DROP TABLE IF EXISTS sales_agent_discount_options;
DROP TABLE IF EXISTS sales_agent_discount_requests;
DROP TYPE IF EXISTS sales_agent_discount_option_status;
DROP TYPE IF EXISTS sales_agent_discount_option_kind;
DROP TYPE IF EXISTS sales_agent_commitment;
DROP TYPE IF EXISTS sales_agent_discount_reason;
DROP TYPE IF EXISTS sales_agent_discount_request_status;
