-- Styles redesign C0 (catalogue commercial fields, PROMPT-styles-redesign "API" block item 2): per-style business data
-- for the /styles size search, card spec row and sustainability facts. All nullable / empty: nothing is derived or
-- back-filled — the business team enters it (curation or the later CSV import).
ALTER TABLE "style_bases"
  ADD COLUMN "fit_min_l_mm" INTEGER,
  ADD COLUMN "fit_max_l_mm" INTEGER,
  ADD COLUMN "fit_min_w_mm" INTEGER,
  ADD COLUMN "fit_max_w_mm" INTEGER,
  ADD COLUMN "fit_min_h_mm" INTEGER,
  ADD COLUMN "fit_max_h_mm" INTEGER,
  ADD COLUMN "moq_units" INTEGER,
  ADD COLUMN "recyclable" BOOLEAN,
  ADD COLUMN "plastic_free" BOOLEAN,
  ADD COLUMN "certifications" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "style_bases"
  ADD CONSTRAINT ck_style_bases__fit_l CHECK (fit_min_l_mm IS NULL OR fit_max_l_mm IS NULL OR (fit_min_l_mm > 0 AND fit_min_l_mm <= fit_max_l_mm)),
  ADD CONSTRAINT ck_style_bases__fit_w CHECK (fit_min_w_mm IS NULL OR fit_max_w_mm IS NULL OR (fit_min_w_mm > 0 AND fit_min_w_mm <= fit_max_w_mm)),
  ADD CONSTRAINT ck_style_bases__fit_h CHECK (fit_min_h_mm IS NULL OR fit_max_h_mm IS NULL OR (fit_min_h_mm > 0 AND fit_min_h_mm <= fit_max_h_mm)),
  ADD CONSTRAINT ck_style_bases__moq CHECK (moq_units IS NULL OR moq_units > 0);
