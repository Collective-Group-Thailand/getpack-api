-- B2.3 folding, engine A offset (schema-design §3.4, A-24): the price components read by the waste and cost
-- engines (legacy `A/CalculateWaste.php`, `A/CalculateCost.php`), and the terms that replace legacy's
-- hard-coded factories (PFO, 23).

-- AlterTable
ALTER TABLE "pl_print_type_terms" ADD COLUMN     "assembly_waste_by_assembly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "diecut_waste_by_box_amount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "four_colour_price_by_max_percent" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "pl_ink_colours" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "ink_colour_id" BIGINT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "is_standard" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_ink_colours" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_process_exclusions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "material_id" BIGINT NOT NULL,
    "process" TEXT NOT NULL,
    "finish_id" BIGINT,
    "assembly_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_process_exclusions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_print_wastes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "difficulty_level_id" BIGINT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "min_percent_print" DECIMAL(7,4),
    "max_percent_print" DECIMAL(7,4),
    "min_paper_sheet_amount" DECIMAL(12,2),
    "max_paper_sheet_amount" DECIMAL(12,2),
    "percent_waste" DECIMAL(7,4) NOT NULL,
    "setup_waste" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_print_wastes" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_finish_wastes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "difficulty_level_id" BIGINT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "finish_id" BIGINT,
    "min_paper_sheet_amount" DECIMAL(12,2),
    "max_paper_sheet_amount" DECIMAL(12,2),
    "percent_waste" DECIMAL(7,4) NOT NULL,
    "setup_waste" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_finish_wastes" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_diecut_wastes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "difficulty_level_id" BIGINT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "diecut_type_id" BIGINT NOT NULL,
    "min_paper_sheet_amount" DECIMAL(12,2),
    "max_paper_sheet_amount" DECIMAL(12,2),
    "min_box_amount" INTEGER,
    "max_box_amount" INTEGER,
    "percent_waste" DECIMAL(7,4) NOT NULL,
    "setup_waste" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_diecut_wastes" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_assembly_wastes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "difficulty_level_id" BIGINT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "assembly_id" BIGINT,
    "min_paper_sheet_amount" DECIMAL(12,2),
    "max_paper_sheet_amount" DECIMAL(12,2),
    "percent_waste" DECIMAL(7,4) NOT NULL,
    "setup_waste" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_assembly_wastes" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_print_plates" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "difficulty_level_id" BIGINT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "machine_id" BIGINT NOT NULL,
    "plate_w_min_in" DECIMAL(10,4) NOT NULL,
    "plate_w_max_in" DECIMAL(10,4) NOT NULL,
    "plate_l_min_in" DECIMAL(10,4) NOT NULL,
    "plate_l_max_in" DECIMAL(10,4) NOT NULL,
    "plate_price" DECIMAL(18,6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_print_plates" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_print_prices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "difficulty_level_id" BIGINT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "machine_id" BIGINT NOT NULL,
    "ink_colour_id" BIGINT NOT NULL,
    "percent_color" DECIMAL(7,4),
    "min_paper_sheet_amount" DECIMAL(12,2),
    "max_paper_sheet_amount" DECIMAL(12,2),
    "price_per_sheet" DECIMAL(18,6),
    "price_per_pcs" DECIMAL(18,6),
    "flat_price_four_color" DECIMAL(18,6),
    "flat_price_four_color_per_pcs" DECIMAL(18,6),
    "price_color_combine_special_color" DECIMAL(18,6),
    "operation_cost" DECIMAL(18,6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_print_prices" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_finish_prices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "difficulty_level_id" BIGINT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "finish_id" BIGINT NOT NULL,
    "machine_id" BIGINT,
    "min_paper_sheet_amount" DECIMAL(12,2),
    "max_paper_sheet_amount" DECIMAL(12,2),
    "finish_price" DECIMAL(18,6),
    "price_per_sheet" DECIMAL(18,6),
    "price_by_area_per_in2" DECIMAL(18,6),
    "min_price" DECIMAL(18,6),
    "tooling_price" DECIMAL(18,6),
    "block_price_per_in2" DECIMAL(18,6),
    "material_price_per_in2" DECIMAL(18,6),
    "operation_cost" DECIMAL(18,6),
    "adds_diecut_window" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_finish_prices" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_finish_plates" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "difficulty_level_id" BIGINT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "finish_id" BIGINT NOT NULL,
    "machine_id" BIGINT NOT NULL,
    "plate_w_min_in" DECIMAL(10,4) NOT NULL,
    "plate_w_max_in" DECIMAL(10,4) NOT NULL,
    "plate_l_min_in" DECIMAL(10,4) NOT NULL,
    "plate_l_max_in" DECIMAL(10,4) NOT NULL,
    "price_per_in2" DECIMAL(18,6) NOT NULL,
    "min_plate_price" DECIMAL(18,6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_finish_plates" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_diecut_prices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "difficulty_level_id" BIGINT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "machine_id" BIGINT NOT NULL,
    "min_paper_sheet_amount" DECIMAL(12,2),
    "max_paper_sheet_amount" DECIMAL(12,2),
    "diecut_price" DECIMAL(18,6),
    "price_per_sheet" DECIMAL(18,6),
    "operation_cost" DECIMAL(18,6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_diecut_prices" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_diecut_block_prices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "difficulty_level_id" BIGINT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "machine_id" BIGINT NOT NULL,
    "block_w_min_in" DECIMAL(10,4) NOT NULL,
    "block_w_max_in" DECIMAL(10,4) NOT NULL,
    "block_l_min_in" DECIMAL(10,4) NOT NULL,
    "block_l_max_in" DECIMAL(10,4) NOT NULL,
    "lay_min" INTEGER,
    "lay_max" INTEGER,
    "diecut_price" DECIMAL(18,6),
    "price_per_drawing" DECIMAL(18,6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_diecut_block_prices" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_assembly_prices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "difficulty_level_id" BIGINT NOT NULL,
    "assembly_id" BIGINT NOT NULL,
    "range_amount_min" INTEGER,
    "range_amount_max" INTEGER,
    "assembly_type" SMALLINT NOT NULL,
    "adds_diecut_window" BOOLEAN NOT NULL DEFAULT false,
    "price_per_cm" DECIMAL(18,6),
    "price_per_pcs" DECIMAL(18,6),
    "min_price" DECIMAL(18,6),
    "minimum_operation" DECIMAL(18,6),
    "block_price" DECIMAL(18,6),
    "material_price_per_in2" DECIMAL(18,6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_assembly_prices" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_assembly_sheets" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "sheet_w_in" DECIMAL(10,4) NOT NULL,
    "sheet_l_in" DECIMAL(10,4) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_assembly_sheets" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_pl_ink_colours__ink_colour_id" ON "pl_ink_colours"("ink_colour_id");

-- CreateIndex
CREATE INDEX "ix_pl_ink_colours__print_type_id" ON "pl_ink_colours"("print_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_ink_colours__price_list_version_id__line_key" ON "pl_ink_colours"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_process_exclusions__material_id" ON "pl_process_exclusions"("material_id");

-- CreateIndex
CREATE INDEX "ix_pl_process_exclusions__finish_id" ON "pl_process_exclusions"("finish_id");

-- CreateIndex
CREATE INDEX "ix_pl_process_exclusions__assembly_id" ON "pl_process_exclusions"("assembly_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_process_exclusions__price_list_version_id__line_key" ON "pl_process_exclusions"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_print_wastes__difficulty_level_id" ON "pl_print_wastes"("difficulty_level_id");

-- CreateIndex
CREATE INDEX "ix_pl_print_wastes__print_type_id" ON "pl_print_wastes"("print_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_print_wastes__price_list_version_id__line_key" ON "pl_print_wastes"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_finish_wastes__difficulty_level_id" ON "pl_finish_wastes"("difficulty_level_id");

-- CreateIndex
CREATE INDEX "ix_pl_finish_wastes__print_type_id" ON "pl_finish_wastes"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_finish_wastes__finish_id" ON "pl_finish_wastes"("finish_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_finish_wastes__price_list_version_id__line_key" ON "pl_finish_wastes"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_diecut_wastes__difficulty_level_id" ON "pl_diecut_wastes"("difficulty_level_id");

-- CreateIndex
CREATE INDEX "ix_pl_diecut_wastes__print_type_id" ON "pl_diecut_wastes"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_diecut_wastes__diecut_type_id" ON "pl_diecut_wastes"("diecut_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_diecut_wastes__price_list_version_id__line_key" ON "pl_diecut_wastes"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_assembly_wastes__difficulty_level_id" ON "pl_assembly_wastes"("difficulty_level_id");

-- CreateIndex
CREATE INDEX "ix_pl_assembly_wastes__print_type_id" ON "pl_assembly_wastes"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_assembly_wastes__assembly_id" ON "pl_assembly_wastes"("assembly_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_assembly_wastes__price_list_version_id__line_key" ON "pl_assembly_wastes"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_print_plates__difficulty_level_id" ON "pl_print_plates"("difficulty_level_id");

-- CreateIndex
CREATE INDEX "ix_pl_print_plates__print_type_id" ON "pl_print_plates"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_print_plates__machine_id" ON "pl_print_plates"("machine_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_print_plates__price_list_version_id__line_key" ON "pl_print_plates"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_print_prices__difficulty_level_id" ON "pl_print_prices"("difficulty_level_id");

-- CreateIndex
CREATE INDEX "ix_pl_print_prices__print_type_id" ON "pl_print_prices"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_print_prices__machine_id" ON "pl_print_prices"("machine_id");

-- CreateIndex
CREATE INDEX "ix_pl_print_prices__ink_colour_id" ON "pl_print_prices"("ink_colour_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_print_prices__price_list_version_id__line_key" ON "pl_print_prices"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_finish_prices__difficulty_level_id" ON "pl_finish_prices"("difficulty_level_id");

-- CreateIndex
CREATE INDEX "ix_pl_finish_prices__print_type_id" ON "pl_finish_prices"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_finish_prices__finish_id" ON "pl_finish_prices"("finish_id");

-- CreateIndex
CREATE INDEX "ix_pl_finish_prices__machine_id" ON "pl_finish_prices"("machine_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_finish_prices__price_list_version_id__line_key" ON "pl_finish_prices"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_finish_plates__difficulty_level_id" ON "pl_finish_plates"("difficulty_level_id");

-- CreateIndex
CREATE INDEX "ix_pl_finish_plates__print_type_id" ON "pl_finish_plates"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_finish_plates__finish_id" ON "pl_finish_plates"("finish_id");

-- CreateIndex
CREATE INDEX "ix_pl_finish_plates__machine_id" ON "pl_finish_plates"("machine_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_finish_plates__price_list_version_id__line_key" ON "pl_finish_plates"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_diecut_prices__difficulty_level_id" ON "pl_diecut_prices"("difficulty_level_id");

-- CreateIndex
CREATE INDEX "ix_pl_diecut_prices__print_type_id" ON "pl_diecut_prices"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_diecut_prices__machine_id" ON "pl_diecut_prices"("machine_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_diecut_prices__price_list_version_id__line_key" ON "pl_diecut_prices"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_diecut_block_prices__difficulty_level_id" ON "pl_diecut_block_prices"("difficulty_level_id");

-- CreateIndex
CREATE INDEX "ix_pl_diecut_block_prices__print_type_id" ON "pl_diecut_block_prices"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_diecut_block_prices__machine_id" ON "pl_diecut_block_prices"("machine_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_diecut_block_prices__price_list_version_id__line_key" ON "pl_diecut_block_prices"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_assembly_prices__difficulty_level_id" ON "pl_assembly_prices"("difficulty_level_id");

-- CreateIndex
CREATE INDEX "ix_pl_assembly_prices__assembly_id" ON "pl_assembly_prices"("assembly_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_assembly_prices__price_list_version_id__line_key" ON "pl_assembly_prices"("price_list_version_id", "line_key");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_assembly_sheets__price_list_version_id__line_key" ON "pl_assembly_sheets"("price_list_version_id", "line_key");

-- AddForeignKey
ALTER TABLE "pl_ink_colours" ADD CONSTRAINT "fk_pl_ink_colours__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_ink_colours" ADD CONSTRAINT "fk_pl_ink_colours__ink_colour_id" FOREIGN KEY ("ink_colour_id") REFERENCES "ink_colours"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_ink_colours" ADD CONSTRAINT "fk_pl_ink_colours__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_process_exclusions" ADD CONSTRAINT "fk_pl_process_exclusions__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_process_exclusions" ADD CONSTRAINT "fk_pl_process_exclusions__material_id" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_process_exclusions" ADD CONSTRAINT "fk_pl_process_exclusions__finish_id" FOREIGN KEY ("finish_id") REFERENCES "finishes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_process_exclusions" ADD CONSTRAINT "fk_pl_process_exclusions__assembly_id" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_print_wastes" ADD CONSTRAINT "fk_pl_print_wastes__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_print_wastes" ADD CONSTRAINT "fk_pl_print_wastes__difficulty_level_id" FOREIGN KEY ("difficulty_level_id") REFERENCES "difficulty_levels"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_print_wastes" ADD CONSTRAINT "fk_pl_print_wastes__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_finish_wastes" ADD CONSTRAINT "fk_pl_finish_wastes__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_finish_wastes" ADD CONSTRAINT "fk_pl_finish_wastes__difficulty_level_id" FOREIGN KEY ("difficulty_level_id") REFERENCES "difficulty_levels"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_finish_wastes" ADD CONSTRAINT "fk_pl_finish_wastes__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_finish_wastes" ADD CONSTRAINT "fk_pl_finish_wastes__finish_id" FOREIGN KEY ("finish_id") REFERENCES "finishes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_diecut_wastes" ADD CONSTRAINT "fk_pl_diecut_wastes__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_diecut_wastes" ADD CONSTRAINT "fk_pl_diecut_wastes__difficulty_level_id" FOREIGN KEY ("difficulty_level_id") REFERENCES "difficulty_levels"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_diecut_wastes" ADD CONSTRAINT "fk_pl_diecut_wastes__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_diecut_wastes" ADD CONSTRAINT "fk_pl_diecut_wastes__diecut_type_id" FOREIGN KEY ("diecut_type_id") REFERENCES "diecut_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_assembly_wastes" ADD CONSTRAINT "fk_pl_assembly_wastes__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_assembly_wastes" ADD CONSTRAINT "fk_pl_assembly_wastes__difficulty_level_id" FOREIGN KEY ("difficulty_level_id") REFERENCES "difficulty_levels"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_assembly_wastes" ADD CONSTRAINT "fk_pl_assembly_wastes__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_assembly_wastes" ADD CONSTRAINT "fk_pl_assembly_wastes__assembly_id" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_print_plates" ADD CONSTRAINT "fk_pl_print_plates__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_print_plates" ADD CONSTRAINT "fk_pl_print_plates__difficulty_level_id" FOREIGN KEY ("difficulty_level_id") REFERENCES "difficulty_levels"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_print_plates" ADD CONSTRAINT "fk_pl_print_plates__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_print_plates" ADD CONSTRAINT "fk_pl_print_plates__machine_id" FOREIGN KEY ("machine_id") REFERENCES "factory_machines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_print_prices" ADD CONSTRAINT "fk_pl_print_prices__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_print_prices" ADD CONSTRAINT "fk_pl_print_prices__difficulty_level_id" FOREIGN KEY ("difficulty_level_id") REFERENCES "difficulty_levels"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_print_prices" ADD CONSTRAINT "fk_pl_print_prices__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_print_prices" ADD CONSTRAINT "fk_pl_print_prices__machine_id" FOREIGN KEY ("machine_id") REFERENCES "factory_machines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_print_prices" ADD CONSTRAINT "fk_pl_print_prices__ink_colour_id" FOREIGN KEY ("ink_colour_id") REFERENCES "ink_colours"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_finish_prices" ADD CONSTRAINT "fk_pl_finish_prices__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_finish_prices" ADD CONSTRAINT "fk_pl_finish_prices__difficulty_level_id" FOREIGN KEY ("difficulty_level_id") REFERENCES "difficulty_levels"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_finish_prices" ADD CONSTRAINT "fk_pl_finish_prices__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_finish_prices" ADD CONSTRAINT "fk_pl_finish_prices__finish_id" FOREIGN KEY ("finish_id") REFERENCES "finishes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_finish_prices" ADD CONSTRAINT "fk_pl_finish_prices__machine_id" FOREIGN KEY ("machine_id") REFERENCES "factory_machines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_finish_plates" ADD CONSTRAINT "fk_pl_finish_plates__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_finish_plates" ADD CONSTRAINT "fk_pl_finish_plates__difficulty_level_id" FOREIGN KEY ("difficulty_level_id") REFERENCES "difficulty_levels"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_finish_plates" ADD CONSTRAINT "fk_pl_finish_plates__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_finish_plates" ADD CONSTRAINT "fk_pl_finish_plates__finish_id" FOREIGN KEY ("finish_id") REFERENCES "finishes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_finish_plates" ADD CONSTRAINT "fk_pl_finish_plates__machine_id" FOREIGN KEY ("machine_id") REFERENCES "factory_machines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_diecut_prices" ADD CONSTRAINT "fk_pl_diecut_prices__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_diecut_prices" ADD CONSTRAINT "fk_pl_diecut_prices__difficulty_level_id" FOREIGN KEY ("difficulty_level_id") REFERENCES "difficulty_levels"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_diecut_prices" ADD CONSTRAINT "fk_pl_diecut_prices__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_diecut_prices" ADD CONSTRAINT "fk_pl_diecut_prices__machine_id" FOREIGN KEY ("machine_id") REFERENCES "factory_machines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_diecut_block_prices" ADD CONSTRAINT "fk_pl_diecut_block_prices__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_diecut_block_prices" ADD CONSTRAINT "fk_pl_diecut_block_prices__difficulty_level_id" FOREIGN KEY ("difficulty_level_id") REFERENCES "difficulty_levels"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_diecut_block_prices" ADD CONSTRAINT "fk_pl_diecut_block_prices__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_diecut_block_prices" ADD CONSTRAINT "fk_pl_diecut_block_prices__machine_id" FOREIGN KEY ("machine_id") REFERENCES "factory_machines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_assembly_prices" ADD CONSTRAINT "fk_pl_assembly_prices__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_assembly_prices" ADD CONSTRAINT "fk_pl_assembly_prices__difficulty_level_id" FOREIGN KEY ("difficulty_level_id") REFERENCES "difficulty_levels"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_assembly_prices" ADD CONSTRAINT "fk_pl_assembly_prices__assembly_id" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_assembly_sheets" ADD CONSTRAINT "fk_pl_assembly_sheets__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- --- hand-written (Prisma cannot express these) --------------------------------------------------

-- pl_ink_colours
CREATE TRIGGER tg_pl_ink_colours__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_ink_colours
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_process_exclusions
ALTER TABLE pl_process_exclusions
  ADD CONSTRAINT ck_pl_process_exclusions__process CHECK (
    (process IN ('print_front', 'print_back') AND finish_id IS NULL AND assembly_id IS NULL)
    OR (process = 'finish' AND finish_id IS NOT NULL AND assembly_id IS NULL)
    OR (process = 'assembly' AND assembly_id IS NOT NULL AND finish_id IS NULL)
  );
CREATE TRIGGER tg_pl_process_exclusions__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_process_exclusions
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_print_wastes
ALTER TABLE pl_print_wastes
  ADD CONSTRAINT ck_pl_print_wastes__percent_band CHECK ((min_percent_print IS NULL OR min_percent_print >= 0) AND (max_percent_print IS NULL OR max_percent_print >= COALESCE(min_percent_print, 0))),
  ADD CONSTRAINT ck_pl_print_wastes__sheet_band CHECK ((min_paper_sheet_amount IS NULL OR min_paper_sheet_amount >= 0) AND (max_paper_sheet_amount IS NULL OR max_paper_sheet_amount >= COALESCE(min_paper_sheet_amount, 0))),
  ADD CONSTRAINT ck_pl_print_wastes__waste CHECK (percent_waste >= 0 AND setup_waste >= 0);
CREATE TRIGGER tg_pl_print_wastes__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_print_wastes
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_finish_wastes
ALTER TABLE pl_finish_wastes
  ADD CONSTRAINT ck_pl_finish_wastes__sheet_band CHECK ((min_paper_sheet_amount IS NULL OR min_paper_sheet_amount >= 0) AND (max_paper_sheet_amount IS NULL OR max_paper_sheet_amount >= COALESCE(min_paper_sheet_amount, 0))),
  ADD CONSTRAINT ck_pl_finish_wastes__waste CHECK (percent_waste >= 0 AND setup_waste >= 0);
CREATE TRIGGER tg_pl_finish_wastes__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_finish_wastes
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_diecut_wastes
ALTER TABLE pl_diecut_wastes
  ADD CONSTRAINT ck_pl_diecut_wastes__box_band CHECK ((min_box_amount IS NULL OR min_box_amount >= 0) AND (max_box_amount IS NULL OR max_box_amount >= COALESCE(min_box_amount, 0))),
  ADD CONSTRAINT ck_pl_diecut_wastes__sheet_band CHECK ((min_paper_sheet_amount IS NULL OR min_paper_sheet_amount >= 0) AND (max_paper_sheet_amount IS NULL OR max_paper_sheet_amount >= COALESCE(min_paper_sheet_amount, 0))),
  ADD CONSTRAINT ck_pl_diecut_wastes__waste CHECK (percent_waste >= 0 AND setup_waste >= 0);
CREATE TRIGGER tg_pl_diecut_wastes__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_diecut_wastes
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_assembly_wastes
ALTER TABLE pl_assembly_wastes
  ADD CONSTRAINT ck_pl_assembly_wastes__sheet_band CHECK ((min_paper_sheet_amount IS NULL OR min_paper_sheet_amount >= 0) AND (max_paper_sheet_amount IS NULL OR max_paper_sheet_amount >= COALESCE(min_paper_sheet_amount, 0))),
  ADD CONSTRAINT ck_pl_assembly_wastes__waste CHECK (percent_waste >= 0 AND setup_waste >= 0);
CREATE TRIGGER tg_pl_assembly_wastes__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_assembly_wastes
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_print_plates
ALTER TABLE pl_print_plates
  ADD CONSTRAINT ck_pl_print_plates__size CHECK (plate_w_min_in >= 0 AND plate_w_max_in >= plate_w_min_in AND plate_l_min_in >= 0 AND plate_l_max_in >= plate_l_min_in),
  ADD CONSTRAINT ck_pl_print_plates__price CHECK (plate_price >= 0);
CREATE TRIGGER tg_pl_print_plates__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_print_plates
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_print_prices
ALTER TABLE pl_print_prices
  ADD CONSTRAINT ck_pl_print_prices__sheet_band CHECK ((min_paper_sheet_amount IS NULL OR min_paper_sheet_amount >= 0) AND (max_paper_sheet_amount IS NULL OR max_paper_sheet_amount >= COALESCE(min_paper_sheet_amount, 0))),
  ADD CONSTRAINT ck_pl_print_prices__non_negative CHECK ((price_per_sheet IS NULL OR price_per_sheet >= 0) AND (price_per_pcs IS NULL OR price_per_pcs >= 0) AND (flat_price_four_color IS NULL OR flat_price_four_color >= 0) AND (flat_price_four_color_per_pcs IS NULL OR flat_price_four_color_per_pcs >= 0) AND (price_color_combine_special_color IS NULL OR price_color_combine_special_color >= 0) AND (operation_cost IS NULL OR operation_cost >= 0));
CREATE TRIGGER tg_pl_print_prices__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_print_prices
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_finish_prices
ALTER TABLE pl_finish_prices
  ADD CONSTRAINT ck_pl_finish_prices__sheet_band CHECK ((min_paper_sheet_amount IS NULL OR min_paper_sheet_amount >= 0) AND (max_paper_sheet_amount IS NULL OR max_paper_sheet_amount >= COALESCE(min_paper_sheet_amount, 0))),
  ADD CONSTRAINT ck_pl_finish_prices__non_negative CHECK ((finish_price IS NULL OR finish_price >= 0) AND (price_per_sheet IS NULL OR price_per_sheet >= 0) AND (price_by_area_per_in2 IS NULL OR price_by_area_per_in2 >= 0) AND (min_price IS NULL OR min_price >= 0) AND (tooling_price IS NULL OR tooling_price >= 0) AND (block_price_per_in2 IS NULL OR block_price_per_in2 >= 0) AND (material_price_per_in2 IS NULL OR material_price_per_in2 >= 0) AND (operation_cost IS NULL OR operation_cost >= 0));
CREATE TRIGGER tg_pl_finish_prices__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_finish_prices
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_finish_plates
ALTER TABLE pl_finish_plates
  ADD CONSTRAINT ck_pl_finish_plates__size CHECK (plate_w_min_in >= 0 AND plate_w_max_in >= plate_w_min_in AND plate_l_min_in >= 0 AND plate_l_max_in >= plate_l_min_in),
  ADD CONSTRAINT ck_pl_finish_plates__price CHECK (price_per_in2 >= 0 AND (min_plate_price IS NULL OR min_plate_price >= 0));
CREATE TRIGGER tg_pl_finish_plates__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_finish_plates
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_diecut_prices
ALTER TABLE pl_diecut_prices
  ADD CONSTRAINT ck_pl_diecut_prices__sheet_band CHECK ((min_paper_sheet_amount IS NULL OR min_paper_sheet_amount >= 0) AND (max_paper_sheet_amount IS NULL OR max_paper_sheet_amount >= COALESCE(min_paper_sheet_amount, 0))),
  ADD CONSTRAINT ck_pl_diecut_prices__non_negative CHECK ((diecut_price IS NULL OR diecut_price >= 0) AND (price_per_sheet IS NULL OR price_per_sheet >= 0) AND (operation_cost IS NULL OR operation_cost >= 0));
CREATE TRIGGER tg_pl_diecut_prices__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_diecut_prices
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_diecut_block_prices
ALTER TABLE pl_diecut_block_prices
  ADD CONSTRAINT ck_pl_diecut_block_prices__size CHECK (block_w_min_in >= 0 AND block_w_max_in >= block_w_min_in AND block_l_min_in >= 0 AND block_l_max_in >= block_l_min_in),
  ADD CONSTRAINT ck_pl_diecut_block_prices__lay CHECK ((lay_min IS NULL OR lay_min >= 0) AND (lay_max IS NULL OR lay_max >= COALESCE(lay_min, 0))),
  ADD CONSTRAINT ck_pl_diecut_block_prices__non_negative CHECK ((diecut_price IS NULL OR diecut_price >= 0) AND (price_per_drawing IS NULL OR price_per_drawing >= 0));
CREATE TRIGGER tg_pl_diecut_block_prices__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_diecut_block_prices
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_assembly_prices
ALTER TABLE pl_assembly_prices
  ADD CONSTRAINT ck_pl_assembly_prices__type CHECK (assembly_type BETWEEN 1 AND 4),
  ADD CONSTRAINT ck_pl_assembly_prices__range CHECK ((range_amount_min IS NULL OR range_amount_min >= 0) AND (range_amount_max IS NULL OR range_amount_max >= COALESCE(range_amount_min, 0))),
  ADD CONSTRAINT ck_pl_assembly_prices__non_negative CHECK ((price_per_cm IS NULL OR price_per_cm >= 0) AND (price_per_pcs IS NULL OR price_per_pcs >= 0) AND (min_price IS NULL OR min_price >= 0) AND (minimum_operation IS NULL OR minimum_operation >= 0) AND (block_price IS NULL OR block_price >= 0) AND (material_price_per_in2 IS NULL OR material_price_per_in2 >= 0));
CREATE TRIGGER tg_pl_assembly_prices__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_assembly_prices
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- pl_assembly_sheets
ALTER TABLE pl_assembly_sheets
  ADD CONSTRAINT ck_pl_assembly_sheets__size CHECK (sheet_w_in > 0 AND sheet_l_in > 0);
CREATE TRIGGER tg_pl_assembly_sheets__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_assembly_sheets
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();

-- The engine is chosen per print type: legacy type-A factories run `A/CalculateCost` (offset) or
-- `A/CalculateCostDigital` (digital) on the same waste engine; type-B factories run `B/*`.
ALTER TABLE pl_print_type_terms DROP CONSTRAINT ck_pl_print_type_terms__engine_variant;
ALTER TABLE pl_print_type_terms
  ADD CONSTRAINT ck_pl_print_type_terms__engine_variant CHECK (engine_variant IN ('a_offset', 'a_digital', 'b'));
