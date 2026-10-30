-- D-462 (owner 2026-10-30): staff may give a company a temporary credit limit (it ends at `valid_until`, after which
-- the latest permanent approved version applies again) and a term outside `b2b.credit_terms.allowedDays`, within
-- `b2b.credit_custom_terms`. Both stay versioned and go through the `credit_limit` approval.

-- AlterTable
ALTER TABLE "company_credit_limit_versions" ADD COLUMN "valid_until" TIMESTAMPTZ(6);
ALTER TABLE "company_credit_limit_versions" ADD COLUMN "custom_term" BOOLEAN NOT NULL DEFAULT false;
