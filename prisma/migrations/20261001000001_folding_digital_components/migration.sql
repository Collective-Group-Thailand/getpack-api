-- B2.3 folding, engine A digital (schema-design A-27): legacy `A/CalculateCostDigital.php` prices paper,
-- printing, finishing and the die block with branches on factories 9, 16 and 23; they become terms of the
-- print type, and the columns those branches read join the existing components.

-- AlterTable
ALTER TABLE "pl_assembly_prices" ADD COLUMN     "digital_method" TEXT NOT NULL DEFAULT 'per_piece',
ADD COLUMN     "max_area_sqcm" DECIMAL(12,2),
ADD COLUMN     "min_area_sqcm" DECIMAL(12,2),
ADD COLUMN     "print_type_id" BIGINT;

-- AlterTable
ALTER TABLE "pl_diecut_block_prices" ADD COLUMN     "max_pcs" INTEGER,
ADD COLUMN     "min_diecut_price" DECIMAL(18,6),
ADD COLUMN     "min_pcs" INTEGER,
ADD COLUMN     "price_per_pcs" DECIMAL(18,6);

-- AlterTable
ALTER TABLE "pl_diecut_prices" ADD COLUMN     "min_price" DECIMAL(18,6),
ADD COLUMN     "price_per_pcs" DECIMAL(18,6);

-- AlterTable
ALTER TABLE "pl_print_prices" ADD COLUMN     "add_two_side_per_sqm" DECIMAL(18,6),
ADD COLUMN     "material_id" BIGINT,
ADD COLUMN     "max_box_amount" INTEGER,
ADD COLUMN     "min_box_amount" INTEGER,
ADD COLUMN     "price_ink_per_m2" DECIMAL(18,6);

-- AlterTable
ALTER TABLE "pl_print_type_terms" ADD COLUMN     "cost_multiplier" DECIMAL(7,4) NOT NULL DEFAULT 1,
ADD COLUMN     "digital_diecut_block" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "digital_finish_method" TEXT NOT NULL DEFAULT 'sheet_area',
ADD COLUMN     "digital_paper_method" TEXT NOT NULL DEFAULT 'auto',
ADD COLUMN     "digital_print_band" TEXT NOT NULL DEFAULT 'sheets',
ADD COLUMN     "digital_print_by_material" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "digital_print_method" TEXT NOT NULL DEFAULT 'sheet_area',
ADD COLUMN     "min_lot_price" DECIMAL(18,6),
ADD COLUMN     "trim_dl_mm" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "trim_dw_mm" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "use_paper_amount_for_cal" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "ix_pl_assembly_prices__print_type_id" ON "pl_assembly_prices"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_print_prices__material_id" ON "pl_print_prices"("material_id");

-- AddForeignKey
ALTER TABLE "pl_print_prices" ADD CONSTRAINT "fk_pl_print_prices__material_id" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_assembly_prices" ADD CONSTRAINT "fk_pl_assembly_prices__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- --- hand-written (Prisma cannot express these) --------------------------------------------------
ALTER TABLE pl_print_type_terms
  ADD CONSTRAINT ck_pl_print_type_terms__digital_methods CHECK (
    digital_paper_method IN ('auto', 'per_piece_band', 'per_sheet')
    AND digital_print_method IN ('sheet_area', 'blank_area', 'per_sheet')
    AND digital_print_band IN ('sheets', 'box')
    AND digital_finish_method IN ('sheet_area', 'blank_area_in2', 'per_sheet_per_layout', 'per_sheet')
    AND digital_diecut_block IN ('none', 'per_piece', 'flat_by_pieces')
  ),
  ADD CONSTRAINT ck_pl_print_type_terms__digital_values CHECK (
    cost_multiplier > 0 AND trim_dl_mm >= 0 AND trim_dw_mm >= 0 AND (min_lot_price IS NULL OR min_lot_price >= 0)
  );

ALTER TABLE pl_print_prices
  ADD CONSTRAINT ck_pl_print_prices__box_band CHECK ((min_box_amount IS NULL OR min_box_amount >= 0) AND (max_box_amount IS NULL OR max_box_amount >= COALESCE(min_box_amount, 0))),
  ADD CONSTRAINT ck_pl_print_prices__digital CHECK ((price_ink_per_m2 IS NULL OR price_ink_per_m2 >= 0) AND (add_two_side_per_sqm IS NULL OR add_two_side_per_sqm >= 0));

ALTER TABLE pl_diecut_prices
  ADD CONSTRAINT ck_pl_diecut_prices__digital CHECK ((price_per_pcs IS NULL OR price_per_pcs >= 0) AND (min_price IS NULL OR min_price >= 0));

ALTER TABLE pl_diecut_block_prices
  ADD CONSTRAINT ck_pl_diecut_block_prices__pcs CHECK ((min_pcs IS NULL OR min_pcs >= 0) AND (max_pcs IS NULL OR max_pcs >= COALESCE(min_pcs, 0))),
  ADD CONSTRAINT ck_pl_diecut_block_prices__digital CHECK ((price_per_pcs IS NULL OR price_per_pcs >= 0) AND (min_diecut_price IS NULL OR min_diecut_price >= 0));

ALTER TABLE pl_assembly_prices
  ADD CONSTRAINT ck_pl_assembly_prices__digital_method CHECK (digital_method IN ('per_piece', 'per_piece_area_band', 'per_carton')),
  ADD CONSTRAINT ck_pl_assembly_prices__area CHECK ((min_area_sqcm IS NULL OR min_area_sqcm >= 0) AND (max_area_sqcm IS NULL OR max_area_sqcm >= COALESCE(min_area_sqcm, 0)));
