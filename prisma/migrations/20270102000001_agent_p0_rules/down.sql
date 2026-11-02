-- Rollback of 20270102000001_agent_p0_rules (manual; Prisma has no down migrations). Run only before any
-- statement was approved with progressive withholding, then delete the row from _prisma_migrations.
DROP TABLE IF EXISTS sales_agent_margin_kpis;
DROP TABLE IF EXISTS sales_agent_tax_declarations;
ALTER TABLE sales_agent_statements
  DROP COLUMN IF EXISTS tax_invoice_file_id, DROP COLUMN IF EXISTS tax_invoice_no,
  DROP COLUMN IF EXISTS wht_allowances, DROP COLUMN IF EXISTS wht_amount, DROP COLUMN IF EXISTS wht_annual_tax,
  DROP COLUMN IF EXISTS wht_method, DROP COLUMN IF EXISTS wht_projected, DROP COLUMN IF EXISTS wht_ytd_paid;
ALTER TABLE sales_agent_commissions DROP COLUMN IF EXISTS margin_alert;
ALTER TABLE payable_items DROP COLUMN IF EXISTS wht_commission_fixed;
DROP TYPE IF EXISTS sales_agent_tax_declaration_status;
DROP TYPE IF EXISTS sales_agent_wht_method;
