-- U4.B4 (schema-design A-98; D-280, ADR-0011): what the studio rendered for a design version (artwork tiles and
-- finish masks placed on the sheet) and the print jobs that assemble the print PDF, the digital proof and the 3D
-- snapshot of an ordered version.
-- CreateEnum
CREATE TYPE "design_render_kind" AS ENUM ('tile', 'finish_mask');

-- CreateEnum
CREATE TYPE "studio_print_job_status" AS ENUM ('queued', 'running', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "design_version_renders" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "version_id" BIGINT NOT NULL,
    "side" "print_sides" NOT NULL,
    "kind" "design_render_kind" NOT NULL,
    "separation" TEXT,
    "x_mm" DECIMAL(10,2) NOT NULL,
    "y_mm" DECIMAL(10,2) NOT NULL,
    "width_mm" DECIMAL(10,2) NOT NULL,
    "height_mm" DECIMAL(10,2) NOT NULL,
    "file_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_design_version_renders" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_print_jobs" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "version_id" BIGINT NOT NULL,
    "customer_user_id" BIGINT NOT NULL,
    "quote_id" BIGINT NOT NULL,
    "cart_item_id" BIGINT,
    "order_id" BIGINT,
    "status" "studio_print_job_status" NOT NULL DEFAULT 'queued',
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "print_file_id" BIGINT,
    "proof_file_id" BIGINT,
    "snapshot_file_id" BIGINT,
    "engine_version" TEXT,
    "error" TEXT,
    "submission_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_studio_print_jobs" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_design_version_renders__public_id" ON "design_version_renders"("public_id");

-- CreateIndex
CREATE INDEX "ix_design_version_renders__version_id" ON "design_version_renders"("version_id");

-- CreateIndex
CREATE INDEX "ix_design_version_renders__file_id" ON "design_version_renders"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_studio_print_jobs__public_id" ON "studio_print_jobs"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_studio_print_jobs__cart_item_id" ON "studio_print_jobs"("cart_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_studio_print_jobs__order_id" ON "studio_print_jobs"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_studio_print_jobs__submission_id" ON "studio_print_jobs"("submission_id");

-- CreateIndex
CREATE INDEX "ix_studio_print_jobs__version_id" ON "studio_print_jobs"("version_id");

-- CreateIndex
CREATE INDEX "ix_studio_print_jobs__customer_user_id" ON "studio_print_jobs"("customer_user_id");

-- CreateIndex
CREATE INDEX "ix_studio_print_jobs__quote_id" ON "studio_print_jobs"("quote_id");

-- CreateIndex
CREATE INDEX "ix_studio_print_jobs__print_file_id" ON "studio_print_jobs"("print_file_id");

-- CreateIndex
CREATE INDEX "ix_studio_print_jobs__proof_file_id" ON "studio_print_jobs"("proof_file_id");

-- CreateIndex
CREATE INDEX "ix_studio_print_jobs__snapshot_file_id" ON "studio_print_jobs"("snapshot_file_id");

-- CreateIndex
CREATE INDEX "ix_studio_print_jobs__queue" ON "studio_print_jobs"("status", "locked_until") WHERE (status = ANY (ARRAY['queued'::studio_print_job_status, 'running'::studio_print_job_status]));

-- AddForeignKey
ALTER TABLE "design_version_renders" ADD CONSTRAINT "fk_design_version_renders__version_id" FOREIGN KEY ("version_id") REFERENCES "design_document_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_version_renders" ADD CONSTRAINT "fk_design_version_renders__file_id" FOREIGN KEY ("file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "studio_print_jobs" ADD CONSTRAINT "fk_studio_print_jobs__version_id" FOREIGN KEY ("version_id") REFERENCES "design_document_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "studio_print_jobs" ADD CONSTRAINT "fk_studio_print_jobs__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "studio_print_jobs" ADD CONSTRAINT "fk_studio_print_jobs__quote_id" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "studio_print_jobs" ADD CONSTRAINT "fk_studio_print_jobs__cart_item_id" FOREIGN KEY ("cart_item_id") REFERENCES "cart_items"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "studio_print_jobs" ADD CONSTRAINT "fk_studio_print_jobs__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "studio_print_jobs" ADD CONSTRAINT "fk_studio_print_jobs__print_file_id" FOREIGN KEY ("print_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "studio_print_jobs" ADD CONSTRAINT "fk_studio_print_jobs__proof_file_id" FOREIGN KEY ("proof_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "studio_print_jobs" ADD CONSTRAINT "fk_studio_print_jobs__snapshot_file_id" FOREIGN KEY ("snapshot_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "studio_print_jobs" ADD CONSTRAINT "fk_studio_print_jobs__submission_id" FOREIGN KEY ("submission_id") REFERENCES "artwork_submissions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- Hand-written checks and triggers (A-98).
ALTER TABLE design_version_renders
  ADD CONSTRAINT ck_design_version_renders__placement CHECK (width_mm > 0 AND height_mm > 0),
  ADD CONSTRAINT ck_design_version_renders__side CHECK (side IN ('outside', 'inside')),
  ADD CONSTRAINT ck_design_version_renders__separation CHECK (
    (kind = 'finish_mask') = (separation IS NOT NULL) AND (separation IS NULL OR separation ~ '^[A-Za-z][A-Za-z0-9]{1,31}$'));
-- A version's renders are what was printed: never changed or removed.
CREATE TRIGGER tg_design_version_renders__write_once BEFORE UPDATE OR DELETE ON design_version_renders
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
ALTER TABLE studio_print_jobs
  ADD CONSTRAINT ck_studio_print_jobs__succeeded CHECK (
    status <> 'succeeded' OR (print_file_id IS NOT NULL AND proof_file_id IS NOT NULL AND completed_at IS NOT NULL)),
  ADD CONSTRAINT ck_studio_print_jobs__attempts CHECK (attempts >= 0);
CREATE TRIGGER tg_studio_print_jobs__no_delete BEFORE DELETE ON studio_print_jobs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
