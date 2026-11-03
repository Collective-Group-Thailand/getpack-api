-- Rollback of 20270108000001_pnl_planner (manual). Plans, cells, variance notes and the access log are dropped
-- (management figures only; nothing in the ledger refers to them).
DROP TABLE IF EXISTS pnl_access_logs;
DROP TABLE IF EXISTS pnl_variance_notes;
DROP TABLE IF EXISTS pnl_plan_cells;
DROP TABLE IF EXISTS pnl_plans;
DROP FUNCTION IF EXISTS pnl_forbid_locked_cell_change();
DROP FUNCTION IF EXISTS pnl_forbid_locked_plan_change();
DROP TYPE IF EXISTS pnl_access_purpose;
DROP TYPE IF EXISTS pnl_cell_source;
DROP TYPE IF EXISTS pnl_cell_mode;
DROP TYPE IF EXISTS pnl_plan_status;
DROP TYPE IF EXISTS pnl_scenario;
