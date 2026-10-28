-- Reverts 20261224000001_c1b_stock_hints_basket_pending (apply by hand with psql, then delete the migration's row from
-- `_prisma_migrations`). Pending basket lines are removed first: without the flag they would read as filled forms.
DELETE FROM "rfq_basket_items" WHERE "form_pending" = true AND "rfq_id" IS NULL;
ALTER TABLE "rfq_basket_items" DROP COLUMN IF EXISTS "form_pending";
DROP TABLE IF EXISTS "stock_price_hints";
