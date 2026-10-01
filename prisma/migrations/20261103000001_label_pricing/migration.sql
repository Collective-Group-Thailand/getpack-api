-- U-B6 label, B2.3 Deliverable 2.3 (schema-design §3.4, A-71): the label price components of a factory's price
-- list that the folding components do not cover (legacy `factory_match_print_type` / `calculate_waste_type` and the
-- hard-coded factories 13 / 14, `paper_sheets.sheet_cut_length_inch`, `print_prices.price_roll_thb_per_m2`,
-- digital `diecut_price`). Folding components are reused unchanged for everything else. Port map:
-- docs/legacy/05-label-port-map.md.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "price_component" ADD VALUE 'label_print_type_terms';
ALTER TYPE "price_component" ADD VALUE 'label_paper_sheets';
ALTER TYPE "price_component" ADD VALUE 'label_roll_print_prices';
ALTER TYPE "price_component" ADD VALUE 'label_diecut_prices';

-- CreateTable
CREATE TABLE "pl_label_print_type_terms" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "engine_variant" TEXT NOT NULL,
    "factory_margin_pct" DECIMAL(7,4) NOT NULL,
    "min_order_amount" INTEGER,
    "min_sheet_per_job" INTEGER NOT NULL DEFAULT 0,
    "lead_time_days" DECIMAL(6,2),
    "bulk_lead_time_min_qty" INTEGER,
    "bulk_lead_time_days" DECIMAL(6,2),
    "waste_method" SMALLINT NOT NULL DEFAULT 1,
    "diecut_available" BOOLEAN NOT NULL DEFAULT true,
    "min_roll_length_m" DECIMAL(10,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_label_print_type_terms" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_label_paper_sheets" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "size_w_in" DECIMAL(10,4) NOT NULL,
    "size_l_in" DECIMAL(10,4) NOT NULL,
    "sheet_cut" INTEGER NOT NULL,
    "sheet_w_in" DECIMAL(10,4) NOT NULL,
    "sheet_l_in" DECIMAL(10,4) NOT NULL,
    "sheet_cut_length_in" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_label_paper_sheets" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_label_roll_print_prices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "difficulty_level_id" BIGINT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "ink_colour_id" BIGINT NOT NULL,
    "price_per_m2" DECIMAL(18,6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_label_roll_print_prices" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_label_diecut_prices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "difficulty_level_id" BIGINT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "diecut_type_id" BIGINT,
    "min_paper_sheet_amount" DECIMAL(14,2),
    "max_paper_sheet_amount" DECIMAL(14,2),
    "min_box_amount" INTEGER,
    "max_box_amount" INTEGER,
    "diecut_price" DECIMAL(18,6),
    "price_per_m2" DECIMAL(18,6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_label_diecut_prices" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_pl_label_print_type_terms__print_type_id" ON "pl_label_print_type_terms"("print_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_label_print_type_terms__version__line_key" ON "pl_label_print_type_terms"("price_list_version_id", "line_key");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_label_paper_sheets__version__line_key" ON "pl_label_paper_sheets"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_label_roll_print_prices__difficulty_level_id" ON "pl_label_roll_print_prices"("difficulty_level_id");

-- CreateIndex
CREATE INDEX "ix_pl_label_roll_print_prices__print_type_id" ON "pl_label_roll_print_prices"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_label_roll_print_prices__ink_colour_id" ON "pl_label_roll_print_prices"("ink_colour_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_label_roll_print_prices__version__line_key" ON "pl_label_roll_print_prices"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_label_diecut_prices__difficulty_level_id" ON "pl_label_diecut_prices"("difficulty_level_id");

-- CreateIndex
CREATE INDEX "ix_pl_label_diecut_prices__print_type_id" ON "pl_label_diecut_prices"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_label_diecut_prices__diecut_type_id" ON "pl_label_diecut_prices"("diecut_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_label_diecut_prices__version__line_key" ON "pl_label_diecut_prices"("price_list_version_id", "line_key");

-- AddForeignKey
ALTER TABLE "pl_label_print_type_terms" ADD CONSTRAINT "fk_pl_label_print_type_terms__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_label_print_type_terms" ADD CONSTRAINT "fk_pl_label_print_type_terms__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_label_paper_sheets" ADD CONSTRAINT "fk_pl_label_paper_sheets__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_label_roll_print_prices" ADD CONSTRAINT "fk_pl_label_roll_print_prices__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_label_roll_print_prices" ADD CONSTRAINT "fk_pl_label_roll_print_prices__difficulty_level_id" FOREIGN KEY ("difficulty_level_id") REFERENCES "difficulty_levels"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_label_roll_print_prices" ADD CONSTRAINT "fk_pl_label_roll_print_prices__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_label_roll_print_prices" ADD CONSTRAINT "fk_pl_label_roll_print_prices__ink_colour_id" FOREIGN KEY ("ink_colour_id") REFERENCES "ink_colours"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_label_diecut_prices" ADD CONSTRAINT "fk_pl_label_diecut_prices__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_label_diecut_prices" ADD CONSTRAINT "fk_pl_label_diecut_prices__difficulty_level_id" FOREIGN KEY ("difficulty_level_id") REFERENCES "difficulty_levels"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_label_diecut_prices" ADD CONSTRAINT "fk_pl_label_diecut_prices__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_label_diecut_prices" ADD CONSTRAINT "fk_pl_label_diecut_prices__diecut_type_id" FOREIGN KEY ("diecut_type_id") REFERENCES "diecut_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- Hand-written (A-71)
-- pl_label_print_type_terms
ALTER TABLE pl_label_print_type_terms
  ADD CONSTRAINT ck_pl_label_print_type_terms__engine_variant CHECK (engine_variant IN ('offset', 'digital')),
  -- The factory margin divides by (1 − pct / 100) (legacy `LabelCalculator::calculateCost:1275-1281`).
  ADD CONSTRAINT ck_pl_label_print_type_terms__factory_margin_pct CHECK (factory_margin_pct >= 0 AND factory_margin_pct < 100),
  ADD CONSTRAINT ck_pl_label_print_type_terms__min_order CHECK (min_order_amount IS NULL OR min_order_amount > 0),
  ADD CONSTRAINT ck_pl_label_print_type_terms__min_sheet CHECK (min_sheet_per_job >= 0),
  ADD CONSTRAINT ck_pl_label_print_type_terms__lead_time CHECK ((lead_time_days IS NULL OR lead_time_days >= 0) AND ((bulk_lead_time_min_qty IS NULL) = (bulk_lead_time_days IS NULL)) AND (bulk_lead_time_min_qty IS NULL OR bulk_lead_time_min_qty > 0) AND (bulk_lead_time_days IS NULL OR bulk_lead_time_days >= 0)),
  ADD CONSTRAINT ck_pl_label_print_type_terms__waste_method CHECK (waste_method IN (1, 2)),
  ADD CONSTRAINT ck_pl_label_print_type_terms__min_roll CHECK (min_roll_length_m IS NULL OR min_roll_length_m >= 0);
CREATE TRIGGER tg_pl_label_print_type_terms__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_label_print_type_terms
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_label_paper_sheets
ALTER TABLE pl_label_paper_sheets
  ADD CONSTRAINT ck_pl_label_paper_sheets__size CHECK (size_w_in > 0 AND size_l_in >= 0 AND sheet_w_in > 0 AND sheet_l_in >= 0 AND sheet_cut > 0 AND sheet_cut_length_in >= 0),
  -- A cut length only makes sense on a roll.
  ADD CONSTRAINT ck_pl_label_paper_sheets__cut_on_roll CHECK (sheet_cut_length_in = 0 OR sheet_l_in = 0);
CREATE TRIGGER tg_pl_label_paper_sheets__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_label_paper_sheets
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_label_roll_print_prices
ALTER TABLE pl_label_roll_print_prices
  ADD CONSTRAINT ck_pl_label_roll_print_prices__price CHECK (price_per_m2 >= 0);
CREATE TRIGGER tg_pl_label_roll_print_prices__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_label_roll_print_prices
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_label_diecut_prices
ALTER TABLE pl_label_diecut_prices
  ADD CONSTRAINT ck_pl_label_diecut_prices__sheet_band CHECK ((min_paper_sheet_amount IS NULL OR min_paper_sheet_amount >= 0) AND (max_paper_sheet_amount IS NULL OR max_paper_sheet_amount >= COALESCE(min_paper_sheet_amount, 0))),
  ADD CONSTRAINT ck_pl_label_diecut_prices__box_band CHECK ((min_box_amount IS NULL OR min_box_amount >= 0) AND (max_box_amount IS NULL OR max_box_amount >= COALESCE(min_box_amount, 0))),
  ADD CONSTRAINT ck_pl_label_diecut_prices__non_negative CHECK ((diecut_price IS NULL OR diecut_price >= 0) AND (price_per_m2 IS NULL OR price_per_m2 >= 0));
CREATE TRIGGER tg_pl_label_diecut_prices__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_label_diecut_prices
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();
