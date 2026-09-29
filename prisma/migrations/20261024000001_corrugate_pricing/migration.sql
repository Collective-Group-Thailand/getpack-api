-- U-B6 corrugate (+ combine), B2.3 Deliverable 2.3 (schema-design §3.3, §3.4, A-49): the catalogue data the
-- corrugate blank formulas read (legacy `CalculatorCorrugate::calculate:147-481`), and the corrugate price
-- components of a factory's price list (legacy `find_pattern_type`, `paper_grade_match_flute`, corrugate
-- `difficult_level` / `difficult_match_margin` / `diecut_block_price`, `percent_reduces`,
-- `factory_fix_cost_percents`, `fixed_options`, `factory_rel_pattern_conditions`, digital `print_prices` /
-- `diecut_price`, `assembly_prices`). Folding components are reused where the columns are the same:
-- `pl_finish_prices`, `pl_paper_trims`, `pl_paper_sizes`, `pl_ink_colours`. Port map:
-- docs/legacy/05-corrugate-port-map.md.

-- CreateEnum
CREATE TYPE "corrugate_formula" AS ENUM ('rsc', 'single_tuck', 'double_tuck', 'double_tuck_top_wall', 'double_tuck_side_wall', 'flat_sheet', 'seafood', 'open_top', 'handle', 'handle_rim', 'tele_body', 'tele_lid', 'slide_tray', 'slide_sleeve', 'tray', 'full_overlap');

-- AlterEnum
ALTER TYPE "geometry_determinant" ADD VALUE 'w_over_l';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "geometry_slot" ADD VALUE 'i';
ALTER TYPE "geometry_slot" ADD VALUE 'j';
ALTER TYPE "geometry_slot" ADD VALUE 'k';
ALTER TYPE "geometry_slot" ADD VALUE 'm';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "price_component" ADD VALUE 'board_prices';
ALTER TYPE "price_component" ADD VALUE 'corrugate_print_type_terms';
ALTER TYPE "price_component" ADD VALUE 'corrugate_process_terms';
ALTER TYPE "price_component" ADD VALUE 'corrugate_die_blocks';
ALTER TYPE "price_component" ADD VALUE 'corrugate_print_prices';
ALTER TYPE "price_component" ADD VALUE 'corrugate_diecut_prices';
ALTER TYPE "price_component" ADD VALUE 'corrugate_assembly_prices';
ALTER TYPE "price_component" ADD VALUE 'corrugate_pattern_conditions';
ALTER TYPE "price_component" ADD VALUE 'fixed_options';

-- AlterTable
ALTER TABLE "assemblies" ADD COLUMN     "auto_add" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "flute_types" ADD COLUMN     "ct" DECIMAL(10,4);

-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "coatable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "patterns" ADD COLUMN     "corrugate_formula" "corrugate_formula";

-- AlterTable
ALTER TABLE "standard_sizes" ADD COLUMN     "calc_flute_type_id" BIGINT;

-- AlterTable
ALTER TABLE "sub_patterns" ADD COLUMN     "corrugate_formula" "corrugate_formula";

-- CreateTable
CREATE TABLE "pl_corrugate_print_type_terms" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "engine_variant" TEXT NOT NULL,
    "factory_margin_pct" DECIMAL(7,4) NOT NULL,
    "min_order_amount" INTEGER,
    "lead_time_days" DECIMAL(6,2),
    "bulk_lead_time_min_qty" INTEGER,
    "bulk_lead_time_days" DECIMAL(6,2),
    "max_colours" SMALLINT,
    "paper_cut" BOOLEAN NOT NULL DEFAULT false,
    "pattern_area_percent_method" SMALLINT NOT NULL DEFAULT 0,
    "top_side_combined" BOOLEAN NOT NULL DEFAULT false,
    "trim_dl_mm" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "trim_dw_mm" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "print_fix_cost_per_sqm" DECIMAL(18,6),
    "non_print_fix_cost_per_sqm" DECIMAL(18,6),
    "paper_price_by_order_amount" BOOLEAN NOT NULL DEFAULT false,
    "digital_die_block" BOOLEAN NOT NULL DEFAULT false,
    "min_lot_price" DECIMAL(18,6),
    "digital_back_print_price_per_m2" DECIMAL(18,6),
    "digital_two_side_addon" BOOLEAN NOT NULL DEFAULT false,
    "packing_price_rsc_per_pcs" DECIMAL(18,6),
    "packing_price_other_per_pcs" DECIMAL(18,6),
    "packing_free_on_rsc" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_corrugate_print_type_terms" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_corrugate_process_terms" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "flute_type_id" BIGINT NOT NULL,
    "trim_mm" DECIMAL(10,2) NOT NULL,
    "min_length_m" DECIMAL(10,2) NOT NULL,
    "min_sheet" INTEGER NOT NULL,
    "width_layout_max" INTEGER NOT NULL,
    "pl_rsc_min_in" DECIMAL(10,4) NOT NULL,
    "pl_rsc_max_in" DECIMAL(10,4) NOT NULL,
    "pw_rsc_min_in" DECIMAL(10,4) NOT NULL,
    "pw_rsc_max_in" DECIMAL(10,4) NOT NULL,
    "min_rsc_flap_mm" DECIMAL(10,2) NOT NULL,
    "min_rsc_slh_mm" DECIMAL(10,2) NOT NULL,
    "min_sll_mm" DECIMAL(10,2) NOT NULL,
    "min_slw_mm" DECIMAL(10,2) NOT NULL,
    "gap_mm" DECIMAL(10,2) NOT NULL,
    "tl_mm" DECIMAL(10,2) NOT NULL,
    "tw_mm" DECIMAL(10,2) NOT NULL,
    "min_length_layout_slot" DECIMAL(10,4) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_corrugate_process_terms" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_paper_roll_widths" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "width_in" DECIMAL(10,4) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_paper_roll_widths" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_board_prices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "material_id" BIGINT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "min_sheet" INTEGER,
    "max_sheet" INTEGER,
    "price_per_sqft" DECIMAL(18,6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_board_prices" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_difficulty_levels" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "difficulty_level_id" BIGINT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "print_plate_price_per_in2" DECIMAL(18,6) NOT NULL,
    "min_price_per_pcs" DECIMAL(18,6) NOT NULL,
    "print_waste_pct" DECIMAL(7,4) NOT NULL,
    "print_setup_sheets" INTEGER NOT NULL,
    "diecut_waste_pct" DECIMAL(7,4) NOT NULL,
    "diecut_waste_sheets" INTEGER NOT NULL,
    "assembly_waste_pct" DECIMAL(7,4) NOT NULL,
    "assembly_setup_sheets" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_difficulty_levels" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_difficulty_margins" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "difficulty_level_id" BIGINT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "colour_amount" SMALLINT NOT NULL,
    "percent_margin" DECIMAL(7,4) NOT NULL,
    "min_margin_per_pcs" DECIMAL(18,6) NOT NULL,
    "min_margin_per_job" DECIMAL(18,6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_difficulty_margins" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_percent_reduces" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "min_price" DECIMAL(18,6) NOT NULL,
    "percent" DECIMAL(7,4) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_percent_reduces" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_fix_cost_pcts" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "basis" TEXT NOT NULL,
    "min_value" DECIMAL(18,6),
    "max_value" DECIMAL(18,6),
    "percent" DECIMAL(7,4) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_fix_cost_pcts" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_corrugate_fixed_options" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "pattern_id" BIGINT NOT NULL,
    "sub_pattern_id" BIGINT,
    "box_style" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "assembly_id" BIGINT,
    "delivery_rounds" SMALLINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_corrugate_fixed_options" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_corrugate_pattern_conditions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "flute_type_id" BIGINT NOT NULL,
    "pattern_id" BIGINT NOT NULL,
    "sub_pattern_id" BIGINT,
    "plus_dl_mm" DECIMAL(10,2) NOT NULL,
    "plus_dw_mm" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_corrugate_pattern_conditions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_corrugate_die_blocks" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "flute_type_id" BIGINT,
    "block_max_w_in" DECIMAL(10,4),
    "block_max_l_in" DECIMAL(10,4),
    "side_type" TEXT,
    "min_pcs" INTEGER,
    "max_pcs" INTEGER,
    "block_price" DECIMAL(18,6),
    "min1lay_diecut_price" DECIMAL(18,6),
    "step_diecut_price" DECIMAL(18,6),
    "price_per_pcs" DECIMAL(18,6),
    "min_diecut_price" DECIMAL(18,6),
    "delivery_cost" DECIMAL(18,6),
    "price_per_sqm" DECIMAL(18,6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_corrugate_die_blocks" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_corrugate_print_prices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "ink_colour_id" BIGINT NOT NULL,
    "material_id" BIGINT,
    "min_qty" INTEGER,
    "max_qty" INTEGER,
    "price_per_m2" DECIMAL(18,6) NOT NULL,
    "add_two_side_per_sqm" DECIMAL(18,6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_corrugate_print_prices" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_corrugate_diecut_prices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "difficulty_level_id" BIGINT NOT NULL,
    "min_qty" INTEGER,
    "max_qty" INTEGER,
    "price_per_job" DECIMAL(18,6),
    "price_per_pcs" DECIMAL(18,6),
    "price_per_m2" DECIMAL(18,6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_corrugate_diecut_prices" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_corrugate_assembly_prices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "assembly_id" BIGINT NOT NULL,
    "range_min" INTEGER,
    "range_max" INTEGER,
    "min_area_sqcm" DECIMAL(12,2),
    "max_area_sqcm" DECIMAL(12,2),
    "min_dl_mm" DECIMAL(10,2),
    "max_dl_mm" DECIMAL(10,2),
    "method" TEXT NOT NULL,
    "price_per_pcs" DECIMAL(18,6) NOT NULL,
    "min_price" DECIMAL(18,6),
    "material_price_per_in2" DECIMAL(18,6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_corrugate_assembly_prices" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_pl_corrugate_print_type_terms__print_type_id" ON "pl_corrugate_print_type_terms"("print_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_corrugate_print_type_terms__version__line_key" ON "pl_corrugate_print_type_terms"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_corrugate_process_terms__print_type_id" ON "pl_corrugate_process_terms"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_corrugate_process_terms__flute_type_id" ON "pl_corrugate_process_terms"("flute_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_corrugate_process_terms__price_list_version_id__line_key" ON "pl_corrugate_process_terms"("price_list_version_id", "line_key");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_paper_roll_widths__price_list_version_id__line_key" ON "pl_paper_roll_widths"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_board_prices__material_id" ON "pl_board_prices"("material_id");

-- CreateIndex
CREATE INDEX "ix_pl_board_prices__print_type_id" ON "pl_board_prices"("print_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_board_prices__price_list_version_id__line_key" ON "pl_board_prices"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_difficulty_levels__difficulty_level_id" ON "pl_difficulty_levels"("difficulty_level_id");

-- CreateIndex
CREATE INDEX "ix_pl_difficulty_levels__print_type_id" ON "pl_difficulty_levels"("print_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_difficulty_levels__price_list_version_id__line_key" ON "pl_difficulty_levels"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_difficulty_margins__difficulty_level_id" ON "pl_difficulty_margins"("difficulty_level_id");

-- CreateIndex
CREATE INDEX "ix_pl_difficulty_margins__print_type_id" ON "pl_difficulty_margins"("print_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_difficulty_margins__price_list_version_id__line_key" ON "pl_difficulty_margins"("price_list_version_id", "line_key");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_percent_reduces__price_list_version_id__line_key" ON "pl_percent_reduces"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_fix_cost_pcts__print_type_id" ON "pl_fix_cost_pcts"("print_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_fix_cost_pcts__price_list_version_id__line_key" ON "pl_fix_cost_pcts"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_corrugate_fixed_options__pattern_id" ON "pl_corrugate_fixed_options"("pattern_id");

-- CreateIndex
CREATE INDEX "ix_pl_corrugate_fixed_options__sub_pattern_id" ON "pl_corrugate_fixed_options"("sub_pattern_id");

-- CreateIndex
CREATE INDEX "ix_pl_corrugate_fixed_options__assembly_id" ON "pl_corrugate_fixed_options"("assembly_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_corrugate_fixed_options__price_list_version_id__line_key" ON "pl_corrugate_fixed_options"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_corrugate_pattern_conditions__flute_type_id" ON "pl_corrugate_pattern_conditions"("flute_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_corrugate_pattern_conditions__pattern_id" ON "pl_corrugate_pattern_conditions"("pattern_id");

-- CreateIndex
CREATE INDEX "ix_pl_corrugate_pattern_conditions__sub_pattern_id" ON "pl_corrugate_pattern_conditions"("sub_pattern_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_corrugate_pattern_conditions__version__line_key" ON "pl_corrugate_pattern_conditions"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_corrugate_die_blocks__print_type_id" ON "pl_corrugate_die_blocks"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_corrugate_die_blocks__flute_type_id" ON "pl_corrugate_die_blocks"("flute_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_corrugate_die_blocks__price_list_version_id__line_key" ON "pl_corrugate_die_blocks"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_corrugate_print_prices__print_type_id" ON "pl_corrugate_print_prices"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_corrugate_print_prices__ink_colour_id" ON "pl_corrugate_print_prices"("ink_colour_id");

-- CreateIndex
CREATE INDEX "ix_pl_corrugate_print_prices__material_id" ON "pl_corrugate_print_prices"("material_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_corrugate_print_prices__price_list_version_id__line_key" ON "pl_corrugate_print_prices"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_corrugate_diecut_prices__print_type_id" ON "pl_corrugate_diecut_prices"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_corrugate_diecut_prices__difficulty_level_id" ON "pl_corrugate_diecut_prices"("difficulty_level_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_corrugate_diecut_prices__price_list_version_id__line_key" ON "pl_corrugate_diecut_prices"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_corrugate_assembly_prices__print_type_id" ON "pl_corrugate_assembly_prices"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_corrugate_assembly_prices__assembly_id" ON "pl_corrugate_assembly_prices"("assembly_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_corrugate_assembly_prices__version__line_key" ON "pl_corrugate_assembly_prices"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_standard_sizes__calc_flute_type_id" ON "standard_sizes"("calc_flute_type_id");

-- AddForeignKey
ALTER TABLE "standard_sizes" ADD CONSTRAINT "fk_standard_sizes__calc_flute_type_id" FOREIGN KEY ("calc_flute_type_id") REFERENCES "flute_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_print_type_terms" ADD CONSTRAINT "fk_pl_corrugate_print_type_terms__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_print_type_terms" ADD CONSTRAINT "fk_pl_corrugate_print_type_terms__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_process_terms" ADD CONSTRAINT "fk_pl_corrugate_process_terms__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_process_terms" ADD CONSTRAINT "fk_pl_corrugate_process_terms__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_process_terms" ADD CONSTRAINT "fk_pl_corrugate_process_terms__flute_type_id" FOREIGN KEY ("flute_type_id") REFERENCES "flute_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_paper_roll_widths" ADD CONSTRAINT "fk_pl_paper_roll_widths__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_board_prices" ADD CONSTRAINT "fk_pl_board_prices__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_board_prices" ADD CONSTRAINT "fk_pl_board_prices__material_id" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_board_prices" ADD CONSTRAINT "fk_pl_board_prices__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_difficulty_levels" ADD CONSTRAINT "fk_pl_difficulty_levels__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_difficulty_levels" ADD CONSTRAINT "fk_pl_difficulty_levels__difficulty_level_id" FOREIGN KEY ("difficulty_level_id") REFERENCES "difficulty_levels"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_difficulty_levels" ADD CONSTRAINT "fk_pl_difficulty_levels__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_difficulty_margins" ADD CONSTRAINT "fk_pl_difficulty_margins__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_difficulty_margins" ADD CONSTRAINT "fk_pl_difficulty_margins__difficulty_level_id" FOREIGN KEY ("difficulty_level_id") REFERENCES "difficulty_levels"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_difficulty_margins" ADD CONSTRAINT "fk_pl_difficulty_margins__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_percent_reduces" ADD CONSTRAINT "fk_pl_percent_reduces__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_fix_cost_pcts" ADD CONSTRAINT "fk_pl_fix_cost_pcts__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_fix_cost_pcts" ADD CONSTRAINT "fk_pl_fix_cost_pcts__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_fixed_options" ADD CONSTRAINT "fk_pl_corrugate_fixed_options__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_fixed_options" ADD CONSTRAINT "fk_pl_corrugate_fixed_options__pattern_id" FOREIGN KEY ("pattern_id") REFERENCES "patterns"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_fixed_options" ADD CONSTRAINT "fk_pl_corrugate_fixed_options__sub_pattern_id" FOREIGN KEY ("sub_pattern_id") REFERENCES "sub_patterns"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_fixed_options" ADD CONSTRAINT "fk_pl_corrugate_fixed_options__assembly_id" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_pattern_conditions" ADD CONSTRAINT "fk_pl_corrugate_pattern_conditions__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_pattern_conditions" ADD CONSTRAINT "fk_pl_corrugate_pattern_conditions__flute_type_id" FOREIGN KEY ("flute_type_id") REFERENCES "flute_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_pattern_conditions" ADD CONSTRAINT "fk_pl_corrugate_pattern_conditions__pattern_id" FOREIGN KEY ("pattern_id") REFERENCES "patterns"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_pattern_conditions" ADD CONSTRAINT "fk_pl_corrugate_pattern_conditions__sub_pattern_id" FOREIGN KEY ("sub_pattern_id") REFERENCES "sub_patterns"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_die_blocks" ADD CONSTRAINT "fk_pl_corrugate_die_blocks__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_die_blocks" ADD CONSTRAINT "fk_pl_corrugate_die_blocks__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_die_blocks" ADD CONSTRAINT "fk_pl_corrugate_die_blocks__flute_type_id" FOREIGN KEY ("flute_type_id") REFERENCES "flute_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_print_prices" ADD CONSTRAINT "fk_pl_corrugate_print_prices__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_print_prices" ADD CONSTRAINT "fk_pl_corrugate_print_prices__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_print_prices" ADD CONSTRAINT "fk_pl_corrugate_print_prices__ink_colour_id" FOREIGN KEY ("ink_colour_id") REFERENCES "ink_colours"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_print_prices" ADD CONSTRAINT "fk_pl_corrugate_print_prices__material_id" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_diecut_prices" ADD CONSTRAINT "fk_pl_corrugate_diecut_prices__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_diecut_prices" ADD CONSTRAINT "fk_pl_corrugate_diecut_prices__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_diecut_prices" ADD CONSTRAINT "fk_pl_corrugate_diecut_prices__difficulty_level_id" FOREIGN KEY ("difficulty_level_id") REFERENCES "difficulty_levels"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_assembly_prices" ADD CONSTRAINT "fk_pl_corrugate_assembly_prices__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_assembly_prices" ADD CONSTRAINT "fk_pl_corrugate_assembly_prices__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_corrugate_assembly_prices" ADD CONSTRAINT "fk_pl_corrugate_assembly_prices__assembly_id" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- --- hand-written (Prisma cannot express these) --------------------------------------------------

-- A pattern (or part) is priced by at most one calculator.
ALTER TABLE patterns
  ADD CONSTRAINT ck_patterns__one_formula CHECK (geometry_formula IS NULL OR corrugate_formula IS NULL);
ALTER TABLE sub_patterns
  ADD CONSTRAINT ck_sub_patterns__one_formula CHECK (geometry_formula IS NULL OR corrugate_formula IS NULL);
ALTER TABLE flute_types
  ADD CONSTRAINT ck_flute_types__ct CHECK (ct IS NULL OR ct >= 0);

-- pl_corrugate_print_type_terms
ALTER TABLE pl_corrugate_print_type_terms
  ADD CONSTRAINT ck_pl_corrugate_print_type_terms__engine_variant CHECK (engine_variant IN ('flexo', 'digital')),
  -- The factory margin divides by (1 − pct / 100) (legacy `CalculatorCorrugate::calculate_factory_margin:1956`).
  ADD CONSTRAINT ck_pl_corrugate_print_type_terms__factory_margin_pct CHECK (factory_margin_pct >= 0 AND factory_margin_pct < 100),
  ADD CONSTRAINT ck_pl_corrugate_print_type_terms__min_order CHECK (min_order_amount IS NULL OR min_order_amount > 0),
  ADD CONSTRAINT ck_pl_corrugate_print_type_terms__lead_time CHECK ((lead_time_days IS NULL OR lead_time_days >= 0) AND ((bulk_lead_time_min_qty IS NULL) = (bulk_lead_time_days IS NULL)) AND (bulk_lead_time_min_qty IS NULL OR bulk_lead_time_min_qty > 0) AND (bulk_lead_time_days IS NULL OR bulk_lead_time_days >= 0)),
  ADD CONSTRAINT ck_pl_corrugate_print_type_terms__max_colours CHECK (max_colours IS NULL OR max_colours >= 0),
  ADD CONSTRAINT ck_pl_corrugate_print_type_terms__percent_method CHECK (pattern_area_percent_method IN (0, 1, 2)),
  ADD CONSTRAINT ck_pl_corrugate_print_type_terms__non_negative CHECK ((trim_dl_mm IS NULL OR trim_dl_mm >= 0) AND (trim_dw_mm IS NULL OR trim_dw_mm >= 0) AND (print_fix_cost_per_sqm IS NULL OR print_fix_cost_per_sqm >= 0) AND (non_print_fix_cost_per_sqm IS NULL OR non_print_fix_cost_per_sqm >= 0) AND (min_lot_price IS NULL OR min_lot_price >= 0) AND (digital_back_print_price_per_m2 IS NULL OR digital_back_print_price_per_m2 >= 0) AND (packing_price_rsc_per_pcs IS NULL OR packing_price_rsc_per_pcs >= 0) AND (packing_price_other_per_pcs IS NULL OR packing_price_other_per_pcs >= 0));
CREATE TRIGGER tg_pl_corrugate_print_type_terms__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_corrugate_print_type_terms
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_corrugate_process_terms
ALTER TABLE pl_corrugate_process_terms
  ADD CONSTRAINT ck_pl_corrugate_process_terms__non_negative CHECK ((trim_mm IS NULL OR trim_mm >= 0) AND (min_length_m IS NULL OR min_length_m >= 0) AND (min_sheet IS NULL OR min_sheet >= 0) AND (width_layout_max IS NULL OR width_layout_max >= 0) AND (min_rsc_flap_mm IS NULL OR min_rsc_flap_mm >= 0) AND (min_rsc_slh_mm IS NULL OR min_rsc_slh_mm >= 0) AND (min_sll_mm IS NULL OR min_sll_mm >= 0) AND (min_slw_mm IS NULL OR min_slw_mm >= 0) AND (gap_mm IS NULL OR gap_mm >= 0) AND (tl_mm IS NULL OR tl_mm >= 0) AND (tw_mm IS NULL OR tw_mm >= 0) AND (min_length_layout_slot IS NULL OR min_length_layout_slot >= 0)),
  ADD CONSTRAINT ck_pl_corrugate_process_terms__rsc_limits CHECK (pl_rsc_min_in >= 0 AND pl_rsc_max_in >= pl_rsc_min_in AND pw_rsc_min_in > 0 AND pw_rsc_max_in >= pw_rsc_min_in);
CREATE TRIGGER tg_pl_corrugate_process_terms__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_corrugate_process_terms
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_paper_roll_widths
ALTER TABLE pl_paper_roll_widths
  ADD CONSTRAINT ck_pl_paper_roll_widths__width CHECK (width_in > 0);
CREATE TRIGGER tg_pl_paper_roll_widths__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_paper_roll_widths
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_board_prices
ALTER TABLE pl_board_prices
  ADD CONSTRAINT ck_pl_board_prices__sheet_band CHECK ((min_sheet IS NULL OR min_sheet >= 0) AND (max_sheet IS NULL OR max_sheet >= COALESCE(min_sheet, 0))),
  ADD CONSTRAINT ck_pl_board_prices__price CHECK (price_per_sqft >= 0);
CREATE TRIGGER tg_pl_board_prices__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_board_prices
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_difficulty_levels
ALTER TABLE pl_difficulty_levels
  ADD CONSTRAINT ck_pl_difficulty_levels__non_negative CHECK ((print_plate_price_per_in2 IS NULL OR print_plate_price_per_in2 >= 0) AND (min_price_per_pcs IS NULL OR min_price_per_pcs >= 0) AND (print_waste_pct IS NULL OR print_waste_pct >= 0) AND (print_setup_sheets IS NULL OR print_setup_sheets >= 0) AND (diecut_waste_pct IS NULL OR diecut_waste_pct >= 0) AND (diecut_waste_sheets IS NULL OR diecut_waste_sheets >= 0) AND (assembly_waste_pct IS NULL OR assembly_waste_pct >= 0) AND (assembly_setup_sheets IS NULL OR assembly_setup_sheets >= 0));
CREATE TRIGGER tg_pl_difficulty_levels__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_difficulty_levels
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_difficulty_margins
ALTER TABLE pl_difficulty_margins
  ADD CONSTRAINT ck_pl_difficulty_margins__colour_amount CHECK (colour_amount >= 0),
  -- The print price divides by (1 − pct / 100) (legacy `CalRSCFlexo:930-933`).
  ADD CONSTRAINT ck_pl_difficulty_margins__percent_margin CHECK (percent_margin >= 0 AND percent_margin < 100),
  ADD CONSTRAINT ck_pl_difficulty_margins__non_negative CHECK ((min_margin_per_pcs IS NULL OR min_margin_per_pcs >= 0) AND (min_margin_per_job IS NULL OR min_margin_per_job >= 0));
CREATE TRIGGER tg_pl_difficulty_margins__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_difficulty_margins
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_percent_reduces
ALTER TABLE pl_percent_reduces
  ADD CONSTRAINT ck_pl_percent_reduces__values CHECK (min_price >= 0 AND percent >= 0 AND percent < 100);
CREATE TRIGGER tg_pl_percent_reduces__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_percent_reduces
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_fix_cost_pcts
ALTER TABLE pl_fix_cost_pcts
  ADD CONSTRAINT ck_pl_fix_cost_pcts__basis CHECK (basis IN ('box_area_sqm', 'pcs')),
  ADD CONSTRAINT ck_pl_fix_cost_pcts__band CHECK ((min_value IS NULL OR min_value >= 0) AND (max_value IS NULL OR max_value >= COALESCE(min_value, 0))),
  ADD CONSTRAINT ck_pl_fix_cost_pcts__percent CHECK (percent >= 0);
CREATE TRIGGER tg_pl_fix_cost_pcts__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_fix_cost_pcts
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_corrugate_fixed_options
ALTER TABLE pl_corrugate_fixed_options
  ADD CONSTRAINT ck_pl_corrugate_fixed_options__box_style CHECK (box_style IN ('rsc', 'die_cut')),
  ADD CONSTRAINT ck_pl_corrugate_fixed_options__kind CHECK ((kind = 'assembly' AND assembly_id IS NOT NULL AND delivery_rounds IS NULL) OR (kind = 'diecut_delivery_rounds' AND assembly_id IS NULL AND delivery_rounds IS NOT NULL AND delivery_rounds >= 0));
CREATE TRIGGER tg_pl_corrugate_fixed_options__sub_pattern BEFORE INSERT OR UPDATE ON pl_corrugate_fixed_options
  FOR EACH ROW EXECUTE FUNCTION check_sub_pattern_of_pattern();
CREATE TRIGGER tg_pl_corrugate_fixed_options__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_corrugate_fixed_options
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_corrugate_pattern_conditions
CREATE TRIGGER tg_pl_corrugate_pattern_conditions__sub_pattern BEFORE INSERT OR UPDATE ON pl_corrugate_pattern_conditions
  FOR EACH ROW EXECUTE FUNCTION check_sub_pattern_of_pattern();
CREATE TRIGGER tg_pl_corrugate_pattern_conditions__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_corrugate_pattern_conditions
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_corrugate_die_blocks
ALTER TABLE pl_corrugate_die_blocks
  -- NULL-safe: a CHECK that evaluates to NULL passes, so every comparison is guarded.
  ADD CONSTRAINT ck_pl_corrugate_die_blocks__kind CHECK (
    (kind = 'flexo' AND COALESCE(block_max_w_in > 0 AND block_max_l_in > 0, false) AND block_price IS NOT NULL
      AND ((min1lay_diecut_price IS NOT NULL AND step_diecut_price IS NOT NULL) OR price_per_pcs IS NOT NULL))
    OR (kind = 'digital' AND price_per_sqm IS NOT NULL)
  ),
  ADD CONSTRAINT ck_pl_corrugate_die_blocks__pcs_band CHECK ((min_pcs IS NULL OR min_pcs >= 0) AND (max_pcs IS NULL OR max_pcs >= COALESCE(min_pcs, 0))),
  ADD CONSTRAINT ck_pl_corrugate_die_blocks__non_negative CHECK ((block_price IS NULL OR block_price >= 0) AND (min1lay_diecut_price IS NULL OR min1lay_diecut_price >= 0) AND (step_diecut_price IS NULL OR step_diecut_price >= 0) AND (price_per_pcs IS NULL OR price_per_pcs >= 0) AND (min_diecut_price IS NULL OR min_diecut_price >= 0) AND (delivery_cost IS NULL OR delivery_cost >= 0) AND (price_per_sqm IS NULL OR price_per_sqm >= 0));
CREATE TRIGGER tg_pl_corrugate_die_blocks__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_corrugate_die_blocks
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_corrugate_print_prices
ALTER TABLE pl_corrugate_print_prices
  ADD CONSTRAINT ck_pl_corrugate_print_prices__qty_band CHECK ((min_qty IS NULL OR min_qty >= 0) AND (max_qty IS NULL OR max_qty >= COALESCE(min_qty, 0))),
  ADD CONSTRAINT ck_pl_corrugate_print_prices__non_negative CHECK ((price_per_m2 IS NULL OR price_per_m2 >= 0) AND (add_two_side_per_sqm IS NULL OR add_two_side_per_sqm >= 0));
CREATE TRIGGER tg_pl_corrugate_print_prices__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_corrugate_print_prices
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_corrugate_diecut_prices
ALTER TABLE pl_corrugate_diecut_prices
  ADD CONSTRAINT ck_pl_corrugate_diecut_prices__qty_band CHECK ((min_qty IS NULL OR min_qty >= 0) AND (max_qty IS NULL OR max_qty >= COALESCE(min_qty, 0))),
  ADD CONSTRAINT ck_pl_corrugate_diecut_prices__price CHECK (COALESCE(price_per_job, price_per_pcs, price_per_m2) IS NOT NULL),
  ADD CONSTRAINT ck_pl_corrugate_diecut_prices__non_negative CHECK ((price_per_job IS NULL OR price_per_job >= 0) AND (price_per_pcs IS NULL OR price_per_pcs >= 0) AND (price_per_m2 IS NULL OR price_per_m2 >= 0));
CREATE TRIGGER tg_pl_corrugate_diecut_prices__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_corrugate_diecut_prices
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_corrugate_assembly_prices
ALTER TABLE pl_corrugate_assembly_prices
  ADD CONSTRAINT ck_pl_corrugate_assembly_prices__method CHECK (method IN ('per_piece', 'per_area_piece')),
  ADD CONSTRAINT ck_pl_corrugate_assembly_prices__range CHECK ((range_min IS NULL OR range_min >= 0) AND (range_max IS NULL OR range_max >= COALESCE(range_min, 0))),
  ADD CONSTRAINT ck_pl_corrugate_assembly_prices__area_band CHECK ((min_area_sqcm IS NULL OR min_area_sqcm >= 0) AND (max_area_sqcm IS NULL OR max_area_sqcm >= COALESCE(min_area_sqcm, 0))),
  ADD CONSTRAINT ck_pl_corrugate_assembly_prices__dl_band CHECK ((min_dl_mm IS NULL OR min_dl_mm >= 0) AND (max_dl_mm IS NULL OR max_dl_mm >= COALESCE(min_dl_mm, 0))),
  ADD CONSTRAINT ck_pl_corrugate_assembly_prices__non_negative CHECK ((price_per_pcs IS NULL OR price_per_pcs >= 0) AND (min_price IS NULL OR min_price >= 0) AND (material_price_per_in2 IS NULL OR material_price_per_in2 >= 0));
CREATE TRIGGER tg_pl_corrugate_assembly_prices__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_corrugate_assembly_prices
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();
