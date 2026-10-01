-- U-B6 pouch, B2.3 Deliverable 2.3 (schema-design A-73): the pouch shape on patterns and the pouch price components of a
-- factory's price list (legacy `factory_match_print_type` pouch columns, `paper.price_per_sqcm`, `color.price_per_sqcm`,
-- `assembly_prices`, `production_conditions` types 1 / 2, `factory_margins`, and the constants `PouchCalculator`
-- hard-coded in the lamination and pouch-making formulas). Port map: docs/legacy/05-pouch-port-map.md.

-- CreateEnum
CREATE TYPE "pouch_formula" AS ENUM ('three_side_seal', 'pillow_center_seal', 'center_seal_gusset', 'quad_seal', 'stand_up');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "price_component" ADD VALUE 'pouch_print_type_terms';
ALTER TYPE "price_component" ADD VALUE 'pouch_material_prices';
ALTER TYPE "price_component" ADD VALUE 'pouch_print_prices';
ALTER TYPE "price_component" ADD VALUE 'pouch_option_prices';
ALTER TYPE "price_component" ADD VALUE 'pouch_process_prices';
ALTER TYPE "price_component" ADD VALUE 'pouch_min_quantities';
ALTER TYPE "price_component" ADD VALUE 'pouch_factory_margins';
ALTER TYPE "price_component" ADD VALUE 'pouch_option_rules';

-- AlterTable
ALTER TABLE "patterns" ADD COLUMN     "pouch_formula" "pouch_formula";

-- CreateTable
CREATE TABLE "pl_pouch_print_type_terms" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "tolerance_mm" DECIMAL(10,2) NOT NULL,
    "min_dl_mm" DECIMAL(10,2) NOT NULL,
    "max_dl_mm" DECIMAL(10,2) NOT NULL,
    "min_material_length_m" DECIMAL(10,2) NOT NULL,
    "setup_length_m" DECIMAL(10,2) NOT NULL,
    "web_width_mm" DECIMAL(10,2) NOT NULL,
    "min_material_cost" DECIMAL(18,6) NOT NULL,
    "bridge_mm" DECIMAL(10,2) NOT NULL,
    "factory_margin_pct" DECIMAL(7,4) NOT NULL,
    "lead_time_days" DECIMAL(6,2),
    "lamination_rate_per_m2" DECIMAL(18,6) NOT NULL,
    "lamination_web_width_m" DECIMAL(10,4) NOT NULL,
    "making_qty_threshold" INTEGER NOT NULL,
    "making_price_per_pcs" DECIMAL(18,6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_pouch_print_type_terms" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_pouch_material_prices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "material_id" BIGINT NOT NULL,
    "price_per_cm2" DECIMAL(18,8) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_pouch_material_prices" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_pouch_print_prices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "ink_colour_id" BIGINT NOT NULL,
    "price_per_cm2" DECIMAL(18,8) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_pouch_print_prices" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_pouch_option_prices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "assembly_id" BIGINT NOT NULL,
    "min_qty" INTEGER,
    "max_qty" INTEGER,
    "price_mode" TEXT NOT NULL,
    "price_per_pcs" DECIMAL(18,6),
    "price_per_cm" DECIMAL(18,6),
    "price_per_cm2" DECIMAL(18,8),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_pouch_option_prices" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_pouch_process_prices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "process" TEXT NOT NULL,
    "min_qty" INTEGER,
    "max_qty" INTEGER,
    "min_price" DECIMAL(18,6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_pouch_process_prices" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_pouch_min_quantities" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "min_sqcm" DECIMAL(14,2),
    "max_sqcm" DECIMAL(14,2),
    "min_qty" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_pouch_min_quantities" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_pouch_factory_margins" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "min_qty" INTEGER,
    "max_qty" INTEGER,
    "margin_pct" DECIMAL(7,4) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_pouch_factory_margins" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_pouch_option_rules" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "pattern_id" BIGINT NOT NULL,
    "material_id" BIGINT NOT NULL,
    "assembly_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_pouch_option_rules" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_pl_pouch_print_type_terms__print_type_id" ON "pl_pouch_print_type_terms"("print_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_pouch_print_type_terms__version__line_key" ON "pl_pouch_print_type_terms"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_pouch_material_prices__print_type_id" ON "pl_pouch_material_prices"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_pouch_material_prices__material_id" ON "pl_pouch_material_prices"("material_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_pouch_material_prices__version__line_key" ON "pl_pouch_material_prices"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_pouch_print_prices__print_type_id" ON "pl_pouch_print_prices"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_pouch_print_prices__ink_colour_id" ON "pl_pouch_print_prices"("ink_colour_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_pouch_print_prices__version__line_key" ON "pl_pouch_print_prices"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_pouch_option_prices__print_type_id" ON "pl_pouch_option_prices"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_pouch_option_prices__assembly_id" ON "pl_pouch_option_prices"("assembly_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_pouch_option_prices__version__line_key" ON "pl_pouch_option_prices"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_pouch_process_prices__print_type_id" ON "pl_pouch_process_prices"("print_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_pouch_process_prices__version__line_key" ON "pl_pouch_process_prices"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_pouch_min_quantities__print_type_id" ON "pl_pouch_min_quantities"("print_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_pouch_min_quantities__version__line_key" ON "pl_pouch_min_quantities"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_pouch_factory_margins__print_type_id" ON "pl_pouch_factory_margins"("print_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_pouch_factory_margins__version__line_key" ON "pl_pouch_factory_margins"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_pouch_option_rules__print_type_id" ON "pl_pouch_option_rules"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_pouch_option_rules__pattern_id" ON "pl_pouch_option_rules"("pattern_id");

-- CreateIndex
CREATE INDEX "ix_pl_pouch_option_rules__material_id" ON "pl_pouch_option_rules"("material_id");

-- CreateIndex
CREATE INDEX "ix_pl_pouch_option_rules__assembly_id" ON "pl_pouch_option_rules"("assembly_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_pouch_option_rules__version__line_key" ON "pl_pouch_option_rules"("price_list_version_id", "line_key");

-- AddForeignKey
ALTER TABLE "pl_pouch_print_type_terms" ADD CONSTRAINT "fk_pl_pouch_print_type_terms__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_pouch_print_type_terms" ADD CONSTRAINT "fk_pl_pouch_print_type_terms__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_pouch_material_prices" ADD CONSTRAINT "fk_pl_pouch_material_prices__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_pouch_material_prices" ADD CONSTRAINT "fk_pl_pouch_material_prices__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_pouch_material_prices" ADD CONSTRAINT "fk_pl_pouch_material_prices__material_id" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_pouch_print_prices" ADD CONSTRAINT "fk_pl_pouch_print_prices__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_pouch_print_prices" ADD CONSTRAINT "fk_pl_pouch_print_prices__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_pouch_print_prices" ADD CONSTRAINT "fk_pl_pouch_print_prices__ink_colour_id" FOREIGN KEY ("ink_colour_id") REFERENCES "ink_colours"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_pouch_option_prices" ADD CONSTRAINT "fk_pl_pouch_option_prices__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_pouch_option_prices" ADD CONSTRAINT "fk_pl_pouch_option_prices__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_pouch_option_prices" ADD CONSTRAINT "fk_pl_pouch_option_prices__assembly_id" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_pouch_process_prices" ADD CONSTRAINT "fk_pl_pouch_process_prices__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_pouch_process_prices" ADD CONSTRAINT "fk_pl_pouch_process_prices__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_pouch_min_quantities" ADD CONSTRAINT "fk_pl_pouch_min_quantities__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_pouch_min_quantities" ADD CONSTRAINT "fk_pl_pouch_min_quantities__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_pouch_factory_margins" ADD CONSTRAINT "fk_pl_pouch_factory_margins__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_pouch_factory_margins" ADD CONSTRAINT "fk_pl_pouch_factory_margins__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_pouch_option_rules" ADD CONSTRAINT "fk_pl_pouch_option_rules__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_pouch_option_rules" ADD CONSTRAINT "fk_pl_pouch_option_rules__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_pouch_option_rules" ADD CONSTRAINT "fk_pl_pouch_option_rules__pattern_id" FOREIGN KEY ("pattern_id") REFERENCES "patterns"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_pouch_option_rules" ADD CONSTRAINT "fk_pl_pouch_option_rules__material_id" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_pouch_option_rules" ADD CONSTRAINT "fk_pl_pouch_option_rules__assembly_id" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written (A-73)
ALTER TABLE patterns
  ADD CONSTRAINT ck_patterns__one_pouch_formula CHECK (pouch_formula IS NULL OR (geometry_formula IS NULL AND corrugate_formula IS NULL));

ALTER TABLE pl_pouch_print_type_terms
  ADD CONSTRAINT ck_pl_pouch_print_type_terms__web CHECK (tolerance_mm >= 0 AND min_dl_mm >= 0 AND max_dl_mm > 0 AND min_dl_mm <= max_dl_mm AND web_width_mm >= 0 AND bridge_mm >= 0),
  ADD CONSTRAINT ck_pl_pouch_print_type_terms__run CHECK (min_material_length_m >= 0 AND setup_length_m >= 0 AND min_material_cost >= 0),
  -- The factory margin multiplies the cost (legacy `calculateCost:663-671`).
  ADD CONSTRAINT ck_pl_pouch_print_type_terms__factory_margin_pct CHECK (factory_margin_pct >= 0 AND factory_margin_pct < 100),
  ADD CONSTRAINT ck_pl_pouch_print_type_terms__lead_time CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  ADD CONSTRAINT ck_pl_pouch_print_type_terms__processes CHECK (lamination_rate_per_m2 >= 0 AND lamination_web_width_m >= 0 AND making_qty_threshold >= 0 AND making_price_per_pcs >= 0);
ALTER TABLE pl_pouch_material_prices
  ADD CONSTRAINT ck_pl_pouch_material_prices__price CHECK (price_per_cm2 >= 0);
ALTER TABLE pl_pouch_print_prices
  ADD CONSTRAINT ck_pl_pouch_print_prices__price CHECK (price_per_cm2 >= 0);
ALTER TABLE pl_pouch_option_prices
  ADD CONSTRAINT ck_pl_pouch_option_prices__price_mode CHECK (price_mode IN ('per_piece', 'per_cm2', 'zipper')),
  ADD CONSTRAINT ck_pl_pouch_option_prices__band CHECK ((min_qty IS NULL OR min_qty >= 0) AND (max_qty IS NULL OR max_qty >= COALESCE(min_qty, 0))),
  ADD CONSTRAINT ck_pl_pouch_option_prices__non_negative CHECK ((price_per_pcs IS NULL OR price_per_pcs >= 0) AND (price_per_cm IS NULL OR price_per_cm >= 0) AND (price_per_cm2 IS NULL OR price_per_cm2 >= 0)),
  ADD CONSTRAINT ck_pl_pouch_option_prices__mode_price CHECK ((price_mode <> 'per_cm2' OR price_per_cm2 IS NOT NULL) AND (price_mode <> 'per_piece' OR price_per_pcs IS NOT NULL));
ALTER TABLE pl_pouch_process_prices
  ADD CONSTRAINT ck_pl_pouch_process_prices__process CHECK (process IN ('lamination', 'making')),
  ADD CONSTRAINT ck_pl_pouch_process_prices__band CHECK ((min_qty IS NULL OR min_qty >= 0) AND (max_qty IS NULL OR max_qty >= COALESCE(min_qty, 0))),
  ADD CONSTRAINT ck_pl_pouch_process_prices__price CHECK (min_price >= 0);
ALTER TABLE pl_pouch_min_quantities
  ADD CONSTRAINT ck_pl_pouch_min_quantities__band CHECK ((min_sqcm IS NULL OR min_sqcm >= 0) AND (max_sqcm IS NULL OR max_sqcm >= COALESCE(min_sqcm, 0))),
  ADD CONSTRAINT ck_pl_pouch_min_quantities__qty CHECK (min_qty > 0);
ALTER TABLE pl_pouch_factory_margins
  ADD CONSTRAINT ck_pl_pouch_factory_margins__band CHECK ((min_qty IS NULL OR min_qty >= 0) AND (max_qty IS NULL OR max_qty >= COALESCE(min_qty, 0))),
  ADD CONSTRAINT ck_pl_pouch_factory_margins__margin_pct CHECK (margin_pct >= 0 AND margin_pct < 100);

CREATE TRIGGER tg_pl_pouch_print_type_terms__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_pouch_print_type_terms
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();
CREATE TRIGGER tg_pl_pouch_material_prices__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_pouch_material_prices
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();
CREATE TRIGGER tg_pl_pouch_print_prices__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_pouch_print_prices
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();
CREATE TRIGGER tg_pl_pouch_option_prices__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_pouch_option_prices
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();
CREATE TRIGGER tg_pl_pouch_process_prices__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_pouch_process_prices
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();
CREATE TRIGGER tg_pl_pouch_min_quantities__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_pouch_min_quantities
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();
CREATE TRIGGER tg_pl_pouch_factory_margins__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_pouch_factory_margins
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();
CREATE TRIGGER tg_pl_pouch_option_rules__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_pouch_option_rules
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();
