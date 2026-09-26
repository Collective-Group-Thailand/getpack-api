-- B2.3 folding geometry (schema-design §3.3 / §3.4, A-24, A-25): the platform geometry data of the blank
-- formulas (legacy `calculate_conditions` / `conditions`, pattern condition slots, standard blanks) and
-- the first folding price components, read by the geometry engine: print-type terms, paper trims,
-- pattern deltas, paper prices, sizes and sheets.

-- CreateEnum
CREATE TYPE "geometry_formula" AS ENUM ('tuck_top', 'tray', 'sleeve', 'lid', 'insert', 'hanger_tuck_top', 'popup_tuck_top', 'popup_hanger', 'house', 'fold_flap', 'wagashi', 'wagashi_side_tuck', 'wagashi_open_top', 'flat_overlap', 'flat', 'lock_bottom_top', 'flat_overlap_combined', 'slide_tray', 'slide_sleeve', 'cover_base', 'flat_extended', 'standard_blank');

-- CreateEnum
CREATE TYPE "geometry_determinant" AS ENUM ('w', 'l', 'd', 'x', 'c');

-- CreateEnum
CREATE TYPE "geometry_slot" AS ENUM ('dw', 'dl', 'nd', 'nl', 'nw', 'aux_f', 'aux_f10');

-- AlterTable
ALTER TABLE "patterns" ADD COLUMN     "geometry_formula" "geometry_formula";

-- AlterTable
ALTER TABLE "sub_patterns" ADD COLUMN     "geometry_formula" "geometry_formula",
ADD COLUMN     "swap_dimensions" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "geometry_band_tables" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "catalog_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_geometry_band_tables" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geometry_bands" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "table_id" BIGINT NOT NULL,
    "lower" DECIMAL(12,4) NOT NULL,
    "upper" DECIMAL(12,4) NOT NULL,
    "value" DECIMAL(12,4) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_geometry_bands" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geometry_conditions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "code" TEXT NOT NULL,
    "band_table_id" BIGINT NOT NULL,
    "variable" TEXT NOT NULL,
    "determinant" "geometry_determinant" NOT NULL,
    "status" "catalog_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_geometry_conditions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pattern_geometry_conditions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "pattern_id" BIGINT NOT NULL,
    "sub_pattern_id" BIGINT,
    "slot" "geometry_slot" NOT NULL,
    "seq" SMALLINT NOT NULL DEFAULT 1,
    "condition_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,

    CONSTRAINT "pk_pattern_geometry_conditions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pattern_standard_blanks" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "pattern_id" BIGINT NOT NULL,
    "standard_size_id" BIGINT NOT NULL,
    "dw_mm" DECIMAL(10,2) NOT NULL,
    "dl_mm" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,

    CONSTRAINT "pk_pattern_standard_blanks" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_print_type_terms" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "engine_variant" TEXT NOT NULL,
    "waste_method" SMALLINT NOT NULL,
    "finish2_step_down_waste" BOOLEAN NOT NULL,
    "can_flip_paper_size" BOOLEAN NOT NULL,
    "disable_overlap_layout" BOOLEAN NOT NULL,
    "factory_margin_pct" DECIMAL(7,4) NOT NULL,
    "min_order_amount" INTEGER,
    "min_order_for_production" INTEGER,
    "lead_time_days" DECIMAL(6,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_print_type_terms" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_paper_trims" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "gap_mm" DECIMAL(10,2) NOT NULL,
    "trim_w_mm" DECIMAL(10,2) NOT NULL,
    "trim_l_mm" DECIMAL(10,2) NOT NULL,
    "edge_trim_mm" DECIMAL(10,2) NOT NULL,
    "trim_foil_mm" DECIMAL(10,2) NOT NULL,
    "trim_finish_plate_mm" DECIMAL(10,2) NOT NULL,
    "end_job_trim_mm" DECIMAL(10,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_paper_trims" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_pattern_conditions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "pattern_id" BIGINT NOT NULL,
    "sub_pattern_id" BIGINT,
    "plus_dl_mm" DECIMAL(10,2) NOT NULL,
    "plus_dw_mm" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_pattern_conditions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_material_prices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "material_id" BIGINT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "min_paper_amount" INTEGER,
    "max_paper_amount" INTEGER,
    "cost_per_kg" DECIMAL(18,6),
    "cost_per_pcs" DECIMAL(18,6),
    "cost_per_m2" DECIMAL(18,6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_material_prices" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_paper_sizes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "material_id" BIGINT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "size_w_in" DECIMAL(10,4) NOT NULL,
    "size_l_in" DECIMAL(10,4) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_paper_sizes" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_paper_sheets" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "size_w_in" DECIMAL(10,4) NOT NULL,
    "size_l_in" DECIMAL(10,4) NOT NULL,
    "sheet_cut" SMALLINT NOT NULL,
    "sheet_w_in" DECIMAL(10,4) NOT NULL,
    "sheet_l_in" DECIMAL(10,4) NOT NULL,
    "is_fix_grain" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_paper_sheets" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_geometry_band_tables__public_id" ON "geometry_band_tables"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_geometry_band_tables__code" ON "geometry_band_tables"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ux_geometry_bands__public_id" ON "geometry_bands"("public_id");

-- CreateIndex
CREATE INDEX "ix_geometry_bands__table_id" ON "geometry_bands"("table_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_geometry_conditions__public_id" ON "geometry_conditions"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_geometry_conditions__code" ON "geometry_conditions"("code");

-- CreateIndex
CREATE INDEX "ix_geometry_conditions__band_table_id" ON "geometry_conditions"("band_table_id");

-- CreateIndex
CREATE INDEX "ix_pattern_geometry_conditions__pattern_id" ON "pattern_geometry_conditions"("pattern_id");

-- CreateIndex
CREATE INDEX "ix_pattern_geometry_conditions__sub_pattern_id" ON "pattern_geometry_conditions"("sub_pattern_id");

-- CreateIndex
CREATE INDEX "ix_pattern_geometry_conditions__condition_id" ON "pattern_geometry_conditions"("condition_id");

-- CreateIndex
CREATE INDEX "ix_pattern_standard_blanks__standard_size_id" ON "pattern_standard_blanks"("standard_size_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pattern_standard_blanks__pattern_id__standard_size_id" ON "pattern_standard_blanks"("pattern_id", "standard_size_id");

-- CreateIndex
CREATE INDEX "ix_pl_print_type_terms__print_type_id" ON "pl_print_type_terms"("print_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_print_type_terms__price_list_version_id__line_key" ON "pl_print_type_terms"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_paper_trims__print_type_id" ON "pl_paper_trims"("print_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_paper_trims__price_list_version_id__line_key" ON "pl_paper_trims"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_pattern_conditions__pattern_id" ON "pl_pattern_conditions"("pattern_id");

-- CreateIndex
CREATE INDEX "ix_pl_pattern_conditions__sub_pattern_id" ON "pl_pattern_conditions"("sub_pattern_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_pattern_conditions__price_list_version_id__line_key" ON "pl_pattern_conditions"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_material_prices__material_id" ON "pl_material_prices"("material_id");

-- CreateIndex
CREATE INDEX "ix_pl_material_prices__print_type_id" ON "pl_material_prices"("print_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_material_prices__price_list_version_id__line_key" ON "pl_material_prices"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_paper_sizes__material_id" ON "pl_paper_sizes"("material_id");

-- CreateIndex
CREATE INDEX "ix_pl_paper_sizes__print_type_id" ON "pl_paper_sizes"("print_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_paper_sizes__price_list_version_id__line_key" ON "pl_paper_sizes"("price_list_version_id", "line_key");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_paper_sheets__price_list_version_id__line_key" ON "pl_paper_sheets"("price_list_version_id", "line_key");

-- AddForeignKey
ALTER TABLE "geometry_band_tables" ADD CONSTRAINT "fk_geometry_band_tables__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "geometry_band_tables" ADD CONSTRAINT "fk_geometry_band_tables__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "geometry_bands" ADD CONSTRAINT "fk_geometry_bands__table_id" FOREIGN KEY ("table_id") REFERENCES "geometry_band_tables"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "geometry_bands" ADD CONSTRAINT "fk_geometry_bands__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "geometry_bands" ADD CONSTRAINT "fk_geometry_bands__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "geometry_conditions" ADD CONSTRAINT "fk_geometry_conditions__band_table_id" FOREIGN KEY ("band_table_id") REFERENCES "geometry_band_tables"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "geometry_conditions" ADD CONSTRAINT "fk_geometry_conditions__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "geometry_conditions" ADD CONSTRAINT "fk_geometry_conditions__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pattern_geometry_conditions" ADD CONSTRAINT "fk_pattern_geometry_conditions__pattern_id" FOREIGN KEY ("pattern_id") REFERENCES "patterns"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pattern_geometry_conditions" ADD CONSTRAINT "fk_pattern_geometry_conditions__sub_pattern_id" FOREIGN KEY ("sub_pattern_id") REFERENCES "sub_patterns"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pattern_geometry_conditions" ADD CONSTRAINT "fk_pattern_geometry_conditions__condition_id" FOREIGN KEY ("condition_id") REFERENCES "geometry_conditions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pattern_geometry_conditions" ADD CONSTRAINT "fk_pattern_geometry_conditions__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pattern_standard_blanks" ADD CONSTRAINT "fk_pattern_standard_blanks__pattern_id" FOREIGN KEY ("pattern_id") REFERENCES "patterns"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pattern_standard_blanks" ADD CONSTRAINT "fk_pattern_standard_blanks__standard_size_id" FOREIGN KEY ("standard_size_id") REFERENCES "standard_sizes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pattern_standard_blanks" ADD CONSTRAINT "fk_pattern_standard_blanks__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pattern_standard_blanks" ADD CONSTRAINT "fk_pattern_standard_blanks__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_print_type_terms" ADD CONSTRAINT "fk_pl_print_type_terms__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_print_type_terms" ADD CONSTRAINT "fk_pl_print_type_terms__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_paper_trims" ADD CONSTRAINT "fk_pl_paper_trims__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_paper_trims" ADD CONSTRAINT "fk_pl_paper_trims__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_pattern_conditions" ADD CONSTRAINT "fk_pl_pattern_conditions__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_pattern_conditions" ADD CONSTRAINT "fk_pl_pattern_conditions__pattern_id" FOREIGN KEY ("pattern_id") REFERENCES "patterns"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_pattern_conditions" ADD CONSTRAINT "fk_pl_pattern_conditions__sub_pattern_id" FOREIGN KEY ("sub_pattern_id") REFERENCES "sub_patterns"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_material_prices" ADD CONSTRAINT "fk_pl_material_prices__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_material_prices" ADD CONSTRAINT "fk_pl_material_prices__material_id" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_material_prices" ADD CONSTRAINT "fk_pl_material_prices__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_paper_sizes" ADD CONSTRAINT "fk_pl_paper_sizes__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_paper_sizes" ADD CONSTRAINT "fk_pl_paper_sizes__material_id" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_paper_sizes" ADD CONSTRAINT "fk_pl_paper_sizes__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_paper_sheets" ADD CONSTRAINT "fk_pl_paper_sheets__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;


-- --- hand-written (Prisma cannot express these) --------------------------------------------------

-- --- geometry data (platform catalogue) -----------------------------------------------------------
ALTER TABLE geometry_band_tables
  ADD CONSTRAINT ck_geometry_band_tables__code CHECK (code ~ '^[a-z][a-z0-9_]*$');

ALTER TABLE geometry_bands
  ADD CONSTRAINT ck_geometry_bands__range CHECK (lower <= upper),
  -- One band per dimension value; bounds inclusive like legacy (`condition_lower ≤ v ≤ condition_upper`).
  ADD CONSTRAINT ex_geometry_bands__no_overlap EXCLUDE USING gist (
    table_id WITH =,
    numrange(lower, upper, '[]') WITH &&
  );

ALTER TABLE geometry_conditions
  ADD CONSTRAINT ck_geometry_conditions__code CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  ADD CONSTRAINT ck_geometry_conditions__variable CHECK (variable ~ '^[a-z][a-z0-9_]*$');

CREATE UNIQUE INDEX ux_pattern_geometry_conditions__slot ON pattern_geometry_conditions (pattern_id, COALESCE(sub_pattern_id, 0), slot, seq);
ALTER TABLE pattern_geometry_conditions
  ADD CONSTRAINT ck_pattern_geometry_conditions__seq CHECK (seq >= 1);

ALTER TABLE pattern_standard_blanks
  ADD CONSTRAINT ck_pattern_standard_blanks__size CHECK (dw_mm > 0 AND dl_mm > 0);

-- A sub-pattern reference must be a part of the same pattern.
CREATE FUNCTION check_sub_pattern_of_pattern() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sub_pattern_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sub_patterns WHERE id = NEW.sub_pattern_id AND pattern_id = NEW.pattern_id
  ) THEN
    RAISE EXCEPTION 'sub-pattern % is not a part of pattern %', NEW.sub_pattern_id, NEW.pattern_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_pattern_geometry_conditions__sub_pattern BEFORE INSERT OR UPDATE ON pattern_geometry_conditions
  FOR EACH ROW EXECUTE FUNCTION check_sub_pattern_of_pattern();

-- --- folding price components (frozen with their version, B2.2 `forbid_decided_price_row_change`) --
ALTER TABLE pl_print_type_terms
  ADD CONSTRAINT ck_pl_print_type_terms__engine_variant CHECK (engine_variant IN ('a', 'b')),
  ADD CONSTRAINT ck_pl_print_type_terms__waste_method CHECK (waste_method >= 0),
  -- The factory margin divides by (1 − pct / 100) (legacy `Object/Margin.php:65-90`).
  ADD CONSTRAINT ck_pl_print_type_terms__factory_margin_pct CHECK (factory_margin_pct >= 0 AND factory_margin_pct < 100),
  ADD CONSTRAINT ck_pl_print_type_terms__min_orders CHECK (
    (min_order_amount IS NULL OR min_order_amount > 0) AND (min_order_for_production IS NULL OR min_order_for_production > 0)
  ),
  ADD CONSTRAINT ck_pl_print_type_terms__lead_time_days CHECK (lead_time_days IS NULL OR lead_time_days >= 0);
CREATE TRIGGER tg_pl_print_type_terms__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_print_type_terms
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

ALTER TABLE pl_paper_trims
  ADD CONSTRAINT ck_pl_paper_trims__non_negative CHECK (
    gap_mm >= 0 AND trim_w_mm >= 0 AND trim_l_mm >= 0 AND edge_trim_mm >= 0 AND trim_foil_mm >= 0
    AND trim_finish_plate_mm >= 0 AND (end_job_trim_mm IS NULL OR end_job_trim_mm >= 0)
  );
CREATE TRIGGER tg_pl_paper_trims__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_paper_trims
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

CREATE TRIGGER tg_pl_pattern_conditions__sub_pattern BEFORE INSERT OR UPDATE ON pl_pattern_conditions
  FOR EACH ROW EXECUTE FUNCTION check_sub_pattern_of_pattern();
CREATE TRIGGER tg_pl_pattern_conditions__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_pattern_conditions
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

ALTER TABLE pl_material_prices
  ADD CONSTRAINT ck_pl_material_prices__price CHECK (
    num_nonnulls(cost_per_kg, cost_per_pcs, cost_per_m2) >= 1
    AND (cost_per_kg IS NULL OR cost_per_kg >= 0) AND (cost_per_pcs IS NULL OR cost_per_pcs >= 0)
    AND (cost_per_m2 IS NULL OR cost_per_m2 >= 0)
  ),
  ADD CONSTRAINT ck_pl_material_prices__band CHECK (
    (min_paper_amount IS NULL OR min_paper_amount >= 0)
    AND (max_paper_amount IS NULL OR max_paper_amount >= COALESCE(min_paper_amount, 0))
  );
CREATE TRIGGER tg_pl_material_prices__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_material_prices
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

ALTER TABLE pl_paper_sizes
  ADD CONSTRAINT ck_pl_paper_sizes__size CHECK (size_w_in > 0 AND size_l_in > 0);
CREATE TRIGGER tg_pl_paper_sizes__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_paper_sizes
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

ALTER TABLE pl_paper_sheets
  ADD CONSTRAINT ck_pl_paper_sheets__size CHECK (size_w_in > 0 AND size_l_in > 0 AND sheet_w_in > 0 AND sheet_l_in > 0),
  ADD CONSTRAINT ck_pl_paper_sheets__sheet_cut CHECK (sheet_cut >= 1);
CREATE TRIGGER tg_pl_paper_sheets__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_paper_sheets
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();
