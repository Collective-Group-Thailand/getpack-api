-- C0b (owner decision 2026-10-28, DECISIONS-STAGE-A §9.1): the source of a style's inside fit range. `recipe` = filled
-- by the audited backfill from the approved recipe's size range (only where the range was empty); `business` = entered
-- by curation or the CSV — the backfill never overwrites it. Existing complete ranges were entered by the business.
ALTER TABLE "style_bases" ADD COLUMN "fit_range_source" TEXT;

UPDATE "style_bases" SET "fit_range_source" = 'business'
WHERE fit_min_l_mm IS NOT NULL OR fit_max_l_mm IS NOT NULL OR fit_min_w_mm IS NOT NULL
   OR fit_max_w_mm IS NOT NULL OR fit_min_h_mm IS NOT NULL OR fit_max_h_mm IS NOT NULL;

ALTER TABLE "style_bases"
  ADD CONSTRAINT ck_style_bases__fit_range_source CHECK (fit_range_source IS NULL OR fit_range_source IN ('recipe', 'business'));
