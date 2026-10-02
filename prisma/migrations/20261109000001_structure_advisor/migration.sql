-- U2.2 (schema-design A-85; D-188, D-189, D-235–D-240): the Structure Advisor — partners' signed board data sheets
-- (the only board strength the advisor reads), the write-once recommendation log with everything a replay needs, the
-- customer's append-only choices with the warnings acknowledged, and the recommendation / choice a quotation was saved
-- from.

-- CreateEnum
CREATE TYPE "advisory_outcome" AS ENUM ('recommended', 'no_board_meets_load');

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "advisory_choice_id" BIGINT,
ADD COLUMN     "advisory_recommendation_id" BIGINT;

-- CreateTable
CREATE TABLE "advisory_recommendations" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "channel" "sales_channel" NOT NULL,
    "customer_user_id" BIGINT,
    "anonymous_id" UUID,
    "created_by" BIGINT,
    "product_type_id" BIGINT NOT NULL,
    "pattern_id" BIGINT NOT NULL,
    "catalog_product_id" BIGINT,
    "inputs" JSONB NOT NULL,
    "rule_set_version_id" BIGINT NOT NULL,
    "rule_set" JSONB NOT NULL,
    "engine_version" TEXT NOT NULL,
    "boards" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "outcome" "advisory_outcome" NOT NULL,
    "recommended_material_id" BIGINT,
    "warning_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_advisory_recommendations" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advisory_choices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "recommendation_id" BIGINT NOT NULL,
    "material_id" BIGINT NOT NULL,
    "acknowledged_warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "chosen_by_user_id" BIGINT,
    "anonymous_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_advisory_choices" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_strength_sheets" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "material_id" BIGINT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "ect_kn_per_m" DECIMAL(8,3) NOT NULL,
    "caliper_mm" DECIMAL(6,3) NOT NULL,
    "grammage_gsm" DECIMAL(8,2) NOT NULL,
    "test_method" TEXT NOT NULL,
    "data_sheet_file_id" BIGINT NOT NULL,
    "signed_on" DATE NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,

    CONSTRAINT "pk_board_strength_sheets" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_advisory_recommendations__public_id" ON "advisory_recommendations"("public_id");

-- CreateIndex
CREATE INDEX "ix_advisory_recommendations__customer_user_id__created_at" ON "advisory_recommendations"("customer_user_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_advisory_recommendations__anonymous_id" ON "advisory_recommendations"("anonymous_id");

-- CreateIndex
CREATE INDEX "ix_advisory_recommendations__created_at" ON "advisory_recommendations"("created_at");

-- CreateIndex
CREATE INDEX "ix_advisory_recommendations__created_by" ON "advisory_recommendations"("created_by");

-- CreateIndex
CREATE INDEX "ix_advisory_recommendations__product_type_id" ON "advisory_recommendations"("product_type_id");

-- CreateIndex
CREATE INDEX "ix_advisory_recommendations__pattern_id" ON "advisory_recommendations"("pattern_id");

-- CreateIndex
CREATE INDEX "ix_advisory_recommendations__catalog_product_id" ON "advisory_recommendations"("catalog_product_id");

-- CreateIndex
CREATE INDEX "ix_advisory_recommendations__rule_set_version_id" ON "advisory_recommendations"("rule_set_version_id");

-- CreateIndex
CREATE INDEX "ix_advisory_recommendations__recommended_material_id" ON "advisory_recommendations"("recommended_material_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_advisory_choices__public_id" ON "advisory_choices"("public_id");

-- CreateIndex
CREATE INDEX "ix_advisory_choices__recommendation_id__created_at" ON "advisory_choices"("recommendation_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_advisory_choices__material_id" ON "advisory_choices"("material_id");

-- CreateIndex
CREATE INDEX "ix_advisory_choices__chosen_by_user_id" ON "advisory_choices"("chosen_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_board_strength_sheets__public_id" ON "board_strength_sheets"("public_id");

-- CreateIndex
CREATE INDEX "ix_board_strength_sheets__material_id__effective_from" ON "board_strength_sheets"("material_id", "effective_from");

-- CreateIndex
CREATE INDEX "ix_board_strength_sheets__data_sheet_file_id" ON "board_strength_sheets"("data_sheet_file_id");

-- CreateIndex
CREATE INDEX "ix_board_strength_sheets__created_by" ON "board_strength_sheets"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_board_strength_sheets__factory_id__material_id__version_no" ON "board_strength_sheets"("factory_id", "material_id", "version_no");

-- CreateIndex
CREATE INDEX "ix_quotes__advisory_recommendation_id" ON "quotes"("advisory_recommendation_id");

-- CreateIndex
CREATE INDEX "ix_quotes__advisory_choice_id" ON "quotes"("advisory_choice_id");

-- AddForeignKey
ALTER TABLE "advisory_recommendations" ADD CONSTRAINT "fk_advisory_recommendations__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "advisory_recommendations" ADD CONSTRAINT "fk_advisory_recommendations__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "advisory_recommendations" ADD CONSTRAINT "fk_advisory_recommendations__product_type_id" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "advisory_recommendations" ADD CONSTRAINT "fk_advisory_recommendations__pattern_id" FOREIGN KEY ("pattern_id") REFERENCES "patterns"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "advisory_recommendations" ADD CONSTRAINT "fk_advisory_recommendations__catalog_product_id" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "advisory_recommendations" ADD CONSTRAINT "fk_advisory_recommendations__rule_set_version_id" FOREIGN KEY ("rule_set_version_id") REFERENCES "setting_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "advisory_recommendations" ADD CONSTRAINT "fk_advisory_recommendations__recommended_material_id" FOREIGN KEY ("recommended_material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "advisory_choices" ADD CONSTRAINT "fk_advisory_choices__recommendation_id" FOREIGN KEY ("recommendation_id") REFERENCES "advisory_recommendations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "advisory_choices" ADD CONSTRAINT "fk_advisory_choices__material_id" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "advisory_choices" ADD CONSTRAINT "fk_advisory_choices__chosen_by_user_id" FOREIGN KEY ("chosen_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "board_strength_sheets" ADD CONSTRAINT "fk_board_strength_sheets__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "board_strength_sheets" ADD CONSTRAINT "fk_board_strength_sheets__material_id" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "board_strength_sheets" ADD CONSTRAINT "fk_board_strength_sheets__data_sheet_file_id" FOREIGN KEY ("data_sheet_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "board_strength_sheets" ADD CONSTRAINT "fk_board_strength_sheets__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "fk_quotes__advisory_recommendation_id" FOREIGN KEY ("advisory_recommendation_id") REFERENCES "advisory_recommendations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "fk_quotes__advisory_choice_id" FOREIGN KEY ("advisory_choice_id") REFERENCES "advisory_choices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- Hand-written (A-85)
ALTER TABLE board_strength_sheets
  ADD CONSTRAINT ck_board_strength_sheets__version_no CHECK (version_no >= 1),
  ADD CONSTRAINT ck_board_strength_sheets__ect CHECK (ect_kn_per_m > 0 AND ect_kn_per_m <= 100),
  ADD CONSTRAINT ck_board_strength_sheets__caliper CHECK (caliper_mm > 0 AND caliper_mm <= 50),
  ADD CONSTRAINT ck_board_strength_sheets__grammage CHECK (grammage_gsm > 0 AND grammage_gsm <= 5000),
  ADD CONSTRAINT ck_board_strength_sheets__test_method CHECK (btrim(test_method) <> ''),
  ADD CONSTRAINT ck_board_strength_sheets__note CHECK (note IS NULL OR btrim(note) <> '');
-- D-236: a sheet is never edited; a new version supersedes it.
CREATE TRIGGER tg_board_strength_sheets__append_only BEFORE UPDATE OR DELETE ON board_strength_sheets
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE advisory_recommendations
  ADD CONSTRAINT ck_advisory_recommendations__owner CHECK (
    customer_user_id IS NOT NULL OR anonymous_id IS NOT NULL OR created_by IS NOT NULL),
  ADD CONSTRAINT ck_advisory_recommendations__outcome CHECK (
    (outcome = 'recommended' AND recommended_material_id IS NOT NULL)
    OR (outcome = 'no_board_meets_load' AND recommended_material_id IS NULL)),
  ADD CONSTRAINT ck_advisory_recommendations__engine_version CHECK (btrim(engine_version) <> '');
-- D-240: the log is write-once so a replay always compares against what the customer saw.
CREATE TRIGGER tg_advisory_recommendations__write_once BEFORE UPDATE OR DELETE ON advisory_recommendations
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE advisory_choices
  ADD CONSTRAINT ck_advisory_choices__owner CHECK (chosen_by_user_id IS NOT NULL OR anonymous_id IS NOT NULL);
CREATE TRIGGER tg_advisory_choices__append_only BEFORE UPDATE OR DELETE ON advisory_choices
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE quotes
  ADD CONSTRAINT ck_quotes__advisory CHECK (advisory_choice_id IS NULL OR advisory_recommendation_id IS NOT NULL);
-- The advisory link is set when the quotation is saved and never changes (D-240).
CREATE FUNCTION tg_quotes__advisory_write_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.advisory_recommendation_id IS DISTINCT FROM OLD.advisory_recommendation_id
     OR NEW.advisory_choice_id IS DISTINCT FROM OLD.advisory_choice_id THEN
    RAISE EXCEPTION 'quote % advisory link is write-once', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_quotes__advisory_write_once BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION tg_quotes__advisory_write_once();
