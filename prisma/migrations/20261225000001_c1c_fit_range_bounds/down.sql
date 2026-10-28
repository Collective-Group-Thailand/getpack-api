-- Reverts 20261225000001_c1c_fit_range_bounds (apply by hand with psql, then delete the migration's row from
-- `_prisma_migrations`). Ranges filled from the C1c sources lose their per-bound record; their summary source
-- becomes `recipe` (the only backfill source C0b knew) so the C0b constraint holds again.
UPDATE "style_bases" SET "fit_range_source" = 'recipe'
WHERE fit_range_source IN ('standard_sizes', 'production_envelope', 'combined');

ALTER TABLE "style_bases" DROP CONSTRAINT IF EXISTS ck_style_bases__fit_range_source;
ALTER TABLE "style_bases"
  ADD CONSTRAINT ck_style_bases__fit_range_source CHECK (fit_range_source IS NULL OR fit_range_source IN ('recipe', 'business'));

ALTER TABLE "style_bases" DROP COLUMN IF EXISTS "fit_range_bounds";
