-- Reverts 20261216000001_catalog_print_model (Prisma does not run this file; apply it by hand with psql, then delete
-- the migration's row from `_prisma_migrations` and redeploy the previous release). The admins' print models are lost.
ALTER TABLE "catalog_products" DROP COLUMN IF EXISTS "print_model";
