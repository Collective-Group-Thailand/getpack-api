-- Reverts 20261221000001_style_commercial_fields (Prisma does not run this file; apply it by hand with psql, then delete
-- the migration's row from `_prisma_migrations` and redeploy the previous release). The entered values are lost.
ALTER TABLE "style_bases"
  DROP CONSTRAINT IF EXISTS ck_style_bases__fit_l,
  DROP CONSTRAINT IF EXISTS ck_style_bases__fit_w,
  DROP CONSTRAINT IF EXISTS ck_style_bases__fit_h,
  DROP CONSTRAINT IF EXISTS ck_style_bases__moq,
  DROP COLUMN IF EXISTS "fit_min_l_mm",
  DROP COLUMN IF EXISTS "fit_max_l_mm",
  DROP COLUMN IF EXISTS "fit_min_w_mm",
  DROP COLUMN IF EXISTS "fit_max_w_mm",
  DROP COLUMN IF EXISTS "fit_min_h_mm",
  DROP COLUMN IF EXISTS "fit_max_h_mm",
  DROP COLUMN IF EXISTS "moq_units",
  DROP COLUMN IF EXISTS "recyclable",
  DROP COLUMN IF EXISTS "plastic_free",
  DROP COLUMN IF EXISTS "certifications";
