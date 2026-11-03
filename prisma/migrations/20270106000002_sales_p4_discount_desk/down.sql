-- Rollback of 20270106000002_sales_p4_discount_desk (manual). The approvals, price locks, waterfall access log and
-- the links of discounted quotations are dropped (the quotations and discount memos themselves stay).
DROP TABLE IF EXISTS sales_discounted_quotes;
DROP TABLE IF EXISTS sales_waterfall_views;
DROP TABLE IF EXISTS sales_factory_price_locks;
DROP TABLE IF EXISTS sales_discount_approvals;
DROP TYPE IF EXISTS sales_waterfall_view_purpose;
DROP TYPE IF EXISTS sales_waterfall_tier;
DROP TYPE IF EXISTS sales_factory_price_lock_status;
DROP TYPE IF EXISTS sales_discount_approval_status;
DROP TYPE IF EXISTS sales_discount_approval_level;
