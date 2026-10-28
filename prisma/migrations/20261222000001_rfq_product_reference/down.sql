-- Reverts 20261222000001_rfq_product_reference (Prisma does not run this file; apply it by hand with psql, then delete
-- the migration's row from `_prisma_migrations` and redeploy the previous release). The product references are lost.
DROP INDEX IF EXISTS "ix_rfqs__stock_product_id";
DROP INDEX IF EXISTS "ix_rfqs__catalog_product_id";
ALTER TABLE "rfqs"
  DROP CONSTRAINT IF EXISTS ck_rfqs__one_product,
  DROP CONSTRAINT IF EXISTS "fk_rfqs__stock_product_id",
  DROP CONSTRAINT IF EXISTS "fk_rfqs__catalog_product_id",
  DROP COLUMN IF EXISTS "stock_product_id",
  DROP COLUMN IF EXISTS "catalog_product_id";
