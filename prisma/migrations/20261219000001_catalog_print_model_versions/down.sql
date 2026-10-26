-- Reverts 20261219000001_catalog_print_model_versions (Prisma does not run this file; apply it by hand with psql, then
-- delete the migration's row from `_prisma_migrations` and redeploy the previous release). Each product keeps the model
-- in force now; the version history and future-dated versions are lost (export first).
ALTER TABLE "catalog_products" ADD COLUMN "print_model" JSONB;

UPDATE "catalog_products" p
SET "print_model" = v."model"
FROM (
    SELECT DISTINCT ON ("catalog_product_id") "catalog_product_id", "model"
    FROM "catalog_product_print_models"
    WHERE "effective_from" <= CURRENT_TIMESTAMP
    ORDER BY "catalog_product_id", "effective_from" DESC, "version_no" DESC
) v
WHERE v."catalog_product_id" = p."id";

DROP TABLE IF EXISTS "catalog_product_print_models";
