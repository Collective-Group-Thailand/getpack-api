-- U3.B6 (schema-design A-94; D-272–D-274): partner dieline intake with provenance, structural design requests with
-- their reference files, the `style_not_publishable` unmet-demand source with the style base wanted, and the surface
-- of a search log.
-- CreateEnum
CREATE TYPE "search_surface" AS ENUM ('catalog', 'styles');

-- CreateEnum
CREATE TYPE "style_intake_status" AS ENUM ('submitted', 'matched', 'approved_recipe', 'approved_template', 'rejected');

-- CreateEnum
CREATE TYPE "structural_request_status" AS ENUM ('submitted', 'assigned', 'quoted', 'delivered', 'approved', 'published', 'declined', 'cancelled');

-- AlterEnum
ALTER TYPE "unmet_demand_source" ADD VALUE 'style_not_publishable';

-- AlterTable
ALTER TABLE "search_logs" ADD COLUMN     "surface" "search_surface" NOT NULL DEFAULT 'catalog';

-- AlterTable
ALTER TABLE "unmet_demand_records" ADD COLUMN     "style_base_id" BIGINT;

-- CreateTable
CREATE TABLE "style_intakes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "submitted_by" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "file_id" BIGINT NOT NULL,
    "file_sha256" BYTEA NOT NULL,
    "terms_version_id" BIGINT NOT NULL,
    "proposed_base_id" BIGINT,
    "status" "style_intake_status" NOT NULL DEFAULT 'submitted',
    "matched_recipe_id" BIGINT,
    "deviations" JSONB,
    "result_recipe_id" BIGINT,
    "template_base_id" BIGINT,
    "reject_reason" TEXT,
    "reviewed_by" BIGINT,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_style_intakes" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "structural_design_requests" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "customer_user_id" BIGINT NOT NULL,
    "product_type_id" BIGINT NOT NULL,
    "description" TEXT NOT NULL,
    "length_mm" DECIMAL(10,2),
    "width_mm" DECIMAL(10,2),
    "height_mm" DECIMAL(10,2),
    "measurement_basis" "measurement_basis",
    "quantity" INTEGER,
    "status" "structural_request_status" NOT NULL DEFAULT 'submitted',
    "assigned_to" BIGINT,
    "assigned_at" TIMESTAMPTZ(6),
    "service_rfq_id" BIGINT,
    "delivered_file_id" BIGINT,
    "delivered_at" TIMESTAMPTZ(6),
    "approved_by" BIGINT,
    "approved_at" TIMESTAMPTZ(6),
    "published_base_id" BIGINT,
    "published_at" TIMESTAMPTZ(6),
    "closed_reason" TEXT,
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_structural_design_requests" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "structural_design_request_files" (
    "request_id" BIGINT NOT NULL,
    "file_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_structural_design_request_files" PRIMARY KEY ("request_id","file_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_style_intakes__public_id" ON "style_intakes"("public_id");

-- CreateIndex
CREATE INDEX "ix_style_intakes__factory_id__created_at" ON "style_intakes"("factory_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_style_intakes__status" ON "style_intakes"("status");

-- CreateIndex
CREATE INDEX "ix_style_intakes__submitted_by" ON "style_intakes"("submitted_by");

-- CreateIndex
CREATE INDEX "ix_style_intakes__file_id" ON "style_intakes"("file_id");

-- CreateIndex
CREATE INDEX "ix_style_intakes__terms_version_id" ON "style_intakes"("terms_version_id");

-- CreateIndex
CREATE INDEX "ix_style_intakes__proposed_base_id" ON "style_intakes"("proposed_base_id");

-- CreateIndex
CREATE INDEX "ix_style_intakes__matched_recipe_id" ON "style_intakes"("matched_recipe_id");

-- CreateIndex
CREATE INDEX "ix_style_intakes__result_recipe_id" ON "style_intakes"("result_recipe_id");

-- CreateIndex
CREATE INDEX "ix_style_intakes__template_base_id" ON "style_intakes"("template_base_id");

-- CreateIndex
CREATE INDEX "ix_style_intakes__reviewed_by" ON "style_intakes"("reviewed_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_structural_design_requests__public_id" ON "structural_design_requests"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_structural_design_requests__service_rfq_id" ON "structural_design_requests"("service_rfq_id");

-- CreateIndex
CREATE INDEX "ix_structural_design_requests__customer_user_id__created_at" ON "structural_design_requests"("customer_user_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_structural_design_requests__status" ON "structural_design_requests"("status");

-- CreateIndex
CREATE INDEX "ix_structural_design_requests__product_type_id" ON "structural_design_requests"("product_type_id");

-- CreateIndex
CREATE INDEX "ix_structural_design_requests__assigned_to" ON "structural_design_requests"("assigned_to");

-- CreateIndex
CREATE INDEX "ix_structural_design_requests__delivered_file_id" ON "structural_design_requests"("delivered_file_id");

-- CreateIndex
CREATE INDEX "ix_structural_design_requests__approved_by" ON "structural_design_requests"("approved_by");

-- CreateIndex
CREATE INDEX "ix_structural_design_requests__published_base_id" ON "structural_design_requests"("published_base_id");

-- CreateIndex
CREATE INDEX "ix_structural_design_request_files__file_id" ON "structural_design_request_files"("file_id");

-- CreateIndex
CREATE INDEX "ix_unmet_demand_records__style_base_id" ON "unmet_demand_records"("style_base_id");

-- AddForeignKey
ALTER TABLE "unmet_demand_records" ADD CONSTRAINT "fk_unmet_demand_records__style_base_id" FOREIGN KEY ("style_base_id") REFERENCES "style_bases"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_intakes" ADD CONSTRAINT "fk_style_intakes__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_intakes" ADD CONSTRAINT "fk_style_intakes__submitted_by" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_intakes" ADD CONSTRAINT "fk_style_intakes__file_id" FOREIGN KEY ("file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_intakes" ADD CONSTRAINT "fk_style_intakes__terms_version_id" FOREIGN KEY ("terms_version_id") REFERENCES "setting_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_intakes" ADD CONSTRAINT "fk_style_intakes__proposed_base_id" FOREIGN KEY ("proposed_base_id") REFERENCES "style_bases"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_intakes" ADD CONSTRAINT "fk_style_intakes__matched_recipe_id" FOREIGN KEY ("matched_recipe_id") REFERENCES "style_recipes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_intakes" ADD CONSTRAINT "fk_style_intakes__result_recipe_id" FOREIGN KEY ("result_recipe_id") REFERENCES "style_recipes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_intakes" ADD CONSTRAINT "fk_style_intakes__template_base_id" FOREIGN KEY ("template_base_id") REFERENCES "style_bases"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_intakes" ADD CONSTRAINT "fk_style_intakes__reviewed_by" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "structural_design_requests" ADD CONSTRAINT "fk_structural_design_requests__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "structural_design_requests" ADD CONSTRAINT "fk_structural_design_requests__product_type_id" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "structural_design_requests" ADD CONSTRAINT "fk_structural_design_requests__assigned_to" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "structural_design_requests" ADD CONSTRAINT "fk_structural_design_requests__service_rfq_id" FOREIGN KEY ("service_rfq_id") REFERENCES "rfqs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "structural_design_requests" ADD CONSTRAINT "fk_structural_design_requests__delivered_file_id" FOREIGN KEY ("delivered_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "structural_design_requests" ADD CONSTRAINT "fk_structural_design_requests__approved_by" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "structural_design_requests" ADD CONSTRAINT "fk_structural_design_requests__published_base_id" FOREIGN KEY ("published_base_id") REFERENCES "style_bases"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "structural_design_request_files" ADD CONSTRAINT "fk_structural_design_request_files__request_id" FOREIGN KEY ("request_id") REFERENCES "structural_design_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "structural_design_request_files" ADD CONSTRAINT "fk_structural_design_request_files__file_id" FOREIGN KEY ("file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- Hand-written checks and triggers (A-94).
ALTER TABLE style_intakes
  ADD CONSTRAINT ck_style_intakes__title CHECK (btrim(title) <> ''),
  ADD CONSTRAINT ck_style_intakes__file_sha256 CHECK (octet_length(file_sha256) = 32),
  ADD CONSTRAINT ck_style_intakes__deviations CHECK (deviations IS NULL OR jsonb_typeof(deviations) = 'array'),
  ADD CONSTRAINT ck_style_intakes__reviewed CHECK (
    (status = 'submitted') = (reviewed_by IS NULL AND reviewed_at IS NULL)),
  ADD CONSTRAINT ck_style_intakes__matched CHECK (
    status <> 'matched' OR (matched_recipe_id IS NOT NULL AND deviations IS NOT NULL)),
  ADD CONSTRAINT ck_style_intakes__approved_recipe CHECK (status <> 'approved_recipe' OR result_recipe_id IS NOT NULL),
  ADD CONSTRAINT ck_style_intakes__approved_template CHECK (
    status <> 'approved_template' OR template_base_id IS NOT NULL),
  ADD CONSTRAINT ck_style_intakes__rejected CHECK (
    (status = 'rejected') = (reject_reason IS NOT NULL AND btrim(reject_reason) <> ''));
-- D-272: provenance never changes and an intake is never deleted; a decided intake is final.
CREATE FUNCTION tg_style_intakes__provenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'style intakes are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.factory_id <> OLD.factory_id OR NEW.submitted_by <> OLD.submitted_by OR NEW.file_id <> OLD.file_id
     OR NEW.file_sha256 <> OLD.file_sha256 OR NEW.terms_version_id <> OLD.terms_version_id
     OR OLD.status IN ('approved_recipe', 'approved_template', 'rejected') THEN
    RAISE EXCEPTION 'style intake % provenance is frozen', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_style_intakes__provenance BEFORE UPDATE OR DELETE ON style_intakes
  FOR EACH ROW EXECUTE FUNCTION tg_style_intakes__provenance();

ALTER TABLE structural_design_requests
  ADD CONSTRAINT ck_structural_design_requests__description CHECK (btrim(description) <> ''),
  ADD CONSTRAINT ck_structural_design_requests__sizes CHECK (
    (length_mm IS NULL OR length_mm > 0) AND (width_mm IS NULL OR width_mm > 0) AND (height_mm IS NULL OR height_mm >= 0)),
  ADD CONSTRAINT ck_structural_design_requests__basis CHECK (
    (measurement_basis IS NULL) = (length_mm IS NULL AND width_mm IS NULL AND height_mm IS NULL)),
  ADD CONSTRAINT ck_structural_design_requests__quantity CHECK (quantity IS NULL OR quantity > 0),
  ADD CONSTRAINT ck_structural_design_requests__assigned CHECK (
    status NOT IN ('assigned', 'quoted', 'delivered', 'approved', 'published')
    OR (assigned_to IS NOT NULL AND assigned_at IS NOT NULL)),
  ADD CONSTRAINT ck_structural_design_requests__quoted CHECK (status <> 'quoted' OR service_rfq_id IS NOT NULL),
  ADD CONSTRAINT ck_structural_design_requests__delivered CHECK (
    status NOT IN ('delivered', 'approved', 'published') OR (delivered_file_id IS NOT NULL AND delivered_at IS NOT NULL)),
  ADD CONSTRAINT ck_structural_design_requests__approved CHECK (
    status NOT IN ('approved', 'published') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  ADD CONSTRAINT ck_structural_design_requests__published CHECK (
    (status = 'published') = (published_base_id IS NOT NULL AND published_at IS NOT NULL)),
  ADD CONSTRAINT ck_structural_design_requests__closed CHECK (
    (status IN ('declined', 'cancelled')) = (closed_at IS NOT NULL));
CREATE TRIGGER tg_structural_design_requests__no_delete BEFORE DELETE ON structural_design_requests
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER tg_structural_design_request_files__write_once BEFORE UPDATE OR DELETE ON structural_design_request_files
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
