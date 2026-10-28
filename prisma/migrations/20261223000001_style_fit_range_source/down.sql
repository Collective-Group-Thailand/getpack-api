-- Reverts 20261223000001_style_fit_range_source (apply by hand with psql, then delete the migration's row from
-- `_prisma_migrations`). The ranges stay; only their source is lost.
ALTER TABLE "style_bases"
  DROP CONSTRAINT IF EXISTS ck_style_bases__fit_range_source,
  DROP COLUMN IF EXISTS "fit_range_source";
