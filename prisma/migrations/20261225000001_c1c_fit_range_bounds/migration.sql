-- C1c (owner decision 2026-10-28, DECISIONS-STAGE-A §11.1): the fit-range backfill's fallback order — (a) the approved
-- recipe's range, (b) the style's own standard sizes, (c) the production envelope (calculator size rules ∩ dieline
-- engine limits). Each backfilled bound records its source and basis in `fit_range_bounds`; `fit_range_source` holds the
-- one source of all six bounds, or `combined`. `business` ranges are never overwritten (unchanged from C0b).
ALTER TABLE "style_bases" ADD COLUMN "fit_range_bounds" JSONB;

ALTER TABLE "style_bases" DROP CONSTRAINT IF EXISTS ck_style_bases__fit_range_source;
ALTER TABLE "style_bases"
  ADD CONSTRAINT ck_style_bases__fit_range_source CHECK (
    fit_range_source IS NULL
    OR fit_range_source IN ('recipe', 'standard_sizes', 'production_envelope', 'combined', 'business')
  );
