-- U-B6 tail, folding engine B (schema-design A-76, D-233): the price components only legacy engine B reads — print waste
-- and ink prices by colour count, foil roll and block terms, B's assembly rates and the contribution codes. Engine A's
-- tables are untouched (their line keys and version digests stay as they are). Port map:
-- docs/legacy/05-folding-b-port-map.md §7.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "price_component" ADD VALUE 'b_print_wastes';
ALTER TYPE "price_component" ADD VALUE 'b_print_prices';
ALTER TYPE "price_component" ADD VALUE 'b_assembly_prices';

-- CreateTable
CREATE TABLE "pl_b_print_wastes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "difficulty_level_id" BIGINT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "ink_colour_id" BIGINT NOT NULL,
    "colour_count" SMALLINT NOT NULL,
    "percent_waste" DECIMAL(7,4) NOT NULL,
    "setup_waste" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_b_print_wastes" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_b_print_prices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "difficulty_level_id" BIGINT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "machine_id" BIGINT NOT NULL,
    "ink_colour_id" BIGINT NOT NULL,
    "colour_count" SMALLINT NOT NULL,
    "price_ink_per_m2" DECIMAL(18,6) NOT NULL,
    "price_color_combine_special_color" DECIMAL(18,6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_b_print_prices" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_foil_prices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "difficulty_level_id" BIGINT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "finish_id" BIGINT NOT NULL,
    "price_by_area_per_in2" DECIMAL(18,6) NOT NULL,
    "baht_per_roll" DECIMAL(18,6) NOT NULL,
    "roll_width_in" DECIMAL(10,4) NOT NULL,
    "roll_length_in" DECIMAL(12,4) NOT NULL,
    "block_w_min_in" DECIMAL(10,4) NOT NULL,
    "block_w_max_in" DECIMAL(10,4) NOT NULL,
    "block_l_min_in" DECIMAL(10,4) NOT NULL,
    "block_l_max_in" DECIMAL(10,4) NOT NULL,
    "tooling_price" DECIMAL(18,6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_foil_prices" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_b_assembly_prices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "difficulty_level_id" BIGINT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "assembly_id" BIGINT NOT NULL,
    "range_amount_min" INTEGER,
    "range_amount_max" INTEGER,
    "assembly_type" SMALLINT NOT NULL,
    "price_per_depth_m" DECIMAL(18,6),
    "min_price_per_area_in2" DECIMAL(18,6),
    "price_per_pcs" DECIMAL(18,6),
    "min_price" DECIMAL(18,6),
    "block_price" DECIMAL(18,6),
    "material_price_per_in2" DECIMAL(18,6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_b_assembly_prices" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pl_code_margins" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "max_range_cont_pct" DECIMAL(7,4) NOT NULL,
    "code_name" TEXT,
    "min_cont_baht_per_lot" DECIMAL(18,6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_code_margins" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_pl_b_print_wastes__difficulty_level_id" ON "pl_b_print_wastes"("difficulty_level_id");

-- CreateIndex
CREATE INDEX "ix_pl_b_print_wastes__print_type_id" ON "pl_b_print_wastes"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_b_print_wastes__ink_colour_id" ON "pl_b_print_wastes"("ink_colour_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_b_print_wastes__price_list_version_id__line_key" ON "pl_b_print_wastes"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_b_print_prices__difficulty_level_id" ON "pl_b_print_prices"("difficulty_level_id");

-- CreateIndex
CREATE INDEX "ix_pl_b_print_prices__print_type_id" ON "pl_b_print_prices"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_b_print_prices__machine_id" ON "pl_b_print_prices"("machine_id");

-- CreateIndex
CREATE INDEX "ix_pl_b_print_prices__ink_colour_id" ON "pl_b_print_prices"("ink_colour_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_b_print_prices__price_list_version_id__line_key" ON "pl_b_print_prices"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_foil_prices__difficulty_level_id" ON "pl_foil_prices"("difficulty_level_id");

-- CreateIndex
CREATE INDEX "ix_pl_foil_prices__print_type_id" ON "pl_foil_prices"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_foil_prices__finish_id" ON "pl_foil_prices"("finish_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_foil_prices__price_list_version_id__line_key" ON "pl_foil_prices"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_b_assembly_prices__difficulty_level_id" ON "pl_b_assembly_prices"("difficulty_level_id");

-- CreateIndex
CREATE INDEX "ix_pl_b_assembly_prices__print_type_id" ON "pl_b_assembly_prices"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_b_assembly_prices__assembly_id" ON "pl_b_assembly_prices"("assembly_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_b_assembly_prices__price_list_version_id__line_key" ON "pl_b_assembly_prices"("price_list_version_id", "line_key");

-- CreateIndex
CREATE INDEX "ix_pl_code_margins__print_type_id" ON "pl_code_margins"("print_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_code_margins__price_list_version_id__line_key" ON "pl_code_margins"("price_list_version_id", "line_key");

-- AddForeignKey
ALTER TABLE "pl_b_print_wastes" ADD CONSTRAINT "fk_pl_b_print_wastes__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_b_print_wastes" ADD CONSTRAINT "fk_pl_b_print_wastes__difficulty_level_id" FOREIGN KEY ("difficulty_level_id") REFERENCES "difficulty_levels"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_b_print_wastes" ADD CONSTRAINT "fk_pl_b_print_wastes__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_b_print_wastes" ADD CONSTRAINT "fk_pl_b_print_wastes__ink_colour_id" FOREIGN KEY ("ink_colour_id") REFERENCES "ink_colours"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_b_print_prices" ADD CONSTRAINT "fk_pl_b_print_prices__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_b_print_prices" ADD CONSTRAINT "fk_pl_b_print_prices__difficulty_level_id" FOREIGN KEY ("difficulty_level_id") REFERENCES "difficulty_levels"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_b_print_prices" ADD CONSTRAINT "fk_pl_b_print_prices__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_b_print_prices" ADD CONSTRAINT "fk_pl_b_print_prices__machine_id" FOREIGN KEY ("machine_id") REFERENCES "factory_machines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_b_print_prices" ADD CONSTRAINT "fk_pl_b_print_prices__ink_colour_id" FOREIGN KEY ("ink_colour_id") REFERENCES "ink_colours"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_foil_prices" ADD CONSTRAINT "fk_pl_foil_prices__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_foil_prices" ADD CONSTRAINT "fk_pl_foil_prices__difficulty_level_id" FOREIGN KEY ("difficulty_level_id") REFERENCES "difficulty_levels"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_foil_prices" ADD CONSTRAINT "fk_pl_foil_prices__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_foil_prices" ADD CONSTRAINT "fk_pl_foil_prices__finish_id" FOREIGN KEY ("finish_id") REFERENCES "finishes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_b_assembly_prices" ADD CONSTRAINT "fk_pl_b_assembly_prices__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_b_assembly_prices" ADD CONSTRAINT "fk_pl_b_assembly_prices__difficulty_level_id" FOREIGN KEY ("difficulty_level_id") REFERENCES "difficulty_levels"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_b_assembly_prices" ADD CONSTRAINT "fk_pl_b_assembly_prices__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_b_assembly_prices" ADD CONSTRAINT "fk_pl_b_assembly_prices__assembly_id" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_code_margins" ADD CONSTRAINT "fk_pl_code_margins__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_code_margins" ADD CONSTRAINT "fk_pl_code_margins__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written (A-76)
ALTER TABLE pl_b_print_wastes
  ADD CONSTRAINT ck_pl_b_print_wastes__colour_count CHECK (colour_count >= 1),
  ADD CONSTRAINT ck_pl_b_print_wastes__waste CHECK (percent_waste >= 0 AND setup_waste >= 0);
ALTER TABLE pl_b_print_prices
  ADD CONSTRAINT ck_pl_b_print_prices__colour_count CHECK (colour_count >= 1),
  ADD CONSTRAINT ck_pl_b_print_prices__non_negative CHECK (price_ink_per_m2 >= 0 AND price_color_combine_special_color >= 0);
ALTER TABLE pl_foil_prices
  ADD CONSTRAINT ck_pl_foil_prices__non_negative CHECK (price_by_area_per_in2 >= 0 AND (tooling_price IS NULL OR tooling_price >= 0)),
  ADD CONSTRAINT ck_pl_foil_prices__roll CHECK (baht_per_roll > 0 AND roll_width_in > 0 AND roll_length_in > 0),
  ADD CONSTRAINT ck_pl_foil_prices__block CHECK (block_w_min_in >= 0 AND block_w_max_in >= block_w_min_in AND block_l_min_in >= 0 AND block_l_max_in >= block_l_min_in);
ALTER TABLE pl_b_assembly_prices
  ADD CONSTRAINT ck_pl_b_assembly_prices__type CHECK (assembly_type BETWEEN 1 AND 4),
  ADD CONSTRAINT ck_pl_b_assembly_prices__range CHECK ((range_amount_min IS NULL OR range_amount_min >= 0) AND (range_amount_max IS NULL OR range_amount_max >= COALESCE(range_amount_min, 0))),
  ADD CONSTRAINT ck_pl_b_assembly_prices__rate CHECK (
    (assembly_type = 1 AND price_per_depth_m IS NOT NULL) OR
    (assembly_type = 2 AND min_price_per_area_in2 IS NOT NULL) OR
    (assembly_type IN (3, 4) AND price_per_pcs IS NOT NULL)),
  ADD CONSTRAINT ck_pl_b_assembly_prices__non_negative CHECK ((price_per_depth_m IS NULL OR price_per_depth_m >= 0) AND (min_price_per_area_in2 IS NULL OR min_price_per_area_in2 >= 0) AND (price_per_pcs IS NULL OR price_per_pcs >= 0) AND (min_price IS NULL OR min_price >= 0) AND (block_price IS NULL OR block_price >= 0) AND (material_price_per_in2 IS NULL OR material_price_per_in2 >= 0));
ALTER TABLE pl_code_margins
  ADD CONSTRAINT ck_pl_code_margins__range CHECK (max_range_cont_pct > 0 AND max_range_cont_pct <= 100),
  ADD CONSTRAINT ck_pl_code_margins__min_cont CHECK (min_cont_baht_per_lot >= 0),
  ADD CONSTRAINT ck_pl_code_margins__code_name CHECK (code_name IS NULL OR btrim(code_name) <> '');
CREATE TRIGGER tg_pl_b_print_wastes__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_b_print_wastes
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();
CREATE TRIGGER tg_pl_b_print_prices__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_b_print_prices
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();
CREATE TRIGGER tg_pl_foil_prices__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_foil_prices
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();
CREATE TRIGGER tg_pl_b_assembly_prices__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_b_assembly_prices
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();
CREATE TRIGGER tg_pl_code_margins__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_code_margins
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();
