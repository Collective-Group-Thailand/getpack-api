-- U2.4 (schema-design A-90; D-072, D-192–D-197, D-253–D-259): one `samples` entity for the attached sample (the D-072
-- add-on on a bulk order) and the standalone sample (its own order of kind `sample`, bought through a sample quotation
-- of source `sample`); CS price with the factory's buy amount, the factory's evidence, the customer's decision with its
-- evidence and the locked specification; the D-197 credit (`discount_source` `sample_credit`); claims naming a sample;
-- sample figures on the factory scorecard; evidence photos attached with subject `sample`.
-- CreateEnum
CREATE TYPE "sample_kind" AS ENUM ('attached', 'standalone');

-- CreateEnum
CREATE TYPE "sample_status" AS ENUM ('requested', 'quoted', 'paid', 'in_production', 'shipped', 'delivered', 'approved', 'changes_requested', 'rejected', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "order_kind" AS ENUM ('standard', 'sample');

-- AlterEnum
ALTER TYPE "attachment_subject" ADD VALUE 'sample';

-- AlterEnum
ALTER TYPE "discount_source" ADD VALUE 'sample_credit';

-- AlterEnum
ALTER TYPE "quote_source" ADD VALUE 'sample';

-- AlterTable
ALTER TABLE "claims" ADD COLUMN     "sample_id" BIGINT;

-- AlterTable
ALTER TABLE "factory_scorecards" ADD COLUMN     "sample_avg_lead_days" DECIMAL(7,2),
ADD COLUMN     "sample_jobs_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sample_on_time_pct" DECIMAL(7,4);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "kind" "order_kind" NOT NULL DEFAULT 'standard';

-- CreateTable
CREATE TABLE "samples" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "kind" "sample_kind" NOT NULL,
    "status" "sample_status" NOT NULL,
    "status_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customer_user_id" BIGINT NOT NULL,
    "product_type_id" BIGINT NOT NULL,
    "source_quote_id" BIGINT,
    "source_draft_id" BIGINT,
    "configuration" JSONB NOT NULL,
    "dimensions" JSONB,
    "mockup_option" "mockup_option" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "delivery_postcode" CHAR(5),
    "customer_note" TEXT,
    "order_id" BIGINT,
    "order_line_id" BIGINT,
    "production_job_id" BIGINT,
    "quote_id" BIGINT,
    "previous_sample_id" BIGINT,
    "sell_net_amount" DECIMAL(14,2),
    "sell_gross_amount" DECIMAL(14,2),
    "buy_net_amount" DECIMAL(14,2),
    "parcel_weight_g" INTEGER,
    "lead_time_days" SMALLINT,
    "quoted_at" TIMESTAMPTZ(6),
    "quoted_by" BIGINT,
    "valid_until" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "in_production_at" TIMESTAMPTZ(6),
    "shipped_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "measured_length_mm" DECIMAL(10,2),
    "measured_width_mm" DECIMAL(10,2),
    "measured_depth_mm" DECIMAL(10,2),
    "measured_basis" "measurement_basis",
    "material_used" TEXT,
    "evidence_recorded_at" TIMESTAMPTZ(6),
    "evidence_recorded_by" BIGINT,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" BIGINT,
    "decision_ip" INET,
    "decision_user_agent" TEXT,
    "decision_note" TEXT,
    "evidence_photo_sha256" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approved_spec" JSONB,
    "approved_proof_id" BIGINT,
    "bulk_quote_id" BIGINT,
    "credit_order_id" BIGINT,
    "credit_amount" DECIMAL(14,2),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "cancelled_by" BIGINT,
    "created_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_samples" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_samples__public_id" ON "samples"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_samples__order_line_id" ON "samples"("order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_samples__production_job_id" ON "samples"("production_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_samples__quote_id" ON "samples"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_samples__bulk_quote_id" ON "samples"("bulk_quote_id");

-- CreateIndex
CREATE INDEX "ix_samples__customer_user_id__created_at" ON "samples"("customer_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_samples__status__status_changed_at" ON "samples"("status", "status_changed_at");

-- CreateIndex
CREATE INDEX "ix_samples__order_id" ON "samples"("order_id");

-- CreateIndex
CREATE INDEX "ix_samples__entity_id" ON "samples"("entity_id");

-- CreateIndex
CREATE INDEX "ix_samples__product_type_id" ON "samples"("product_type_id");

-- CreateIndex
CREATE INDEX "ix_samples__source_quote_id" ON "samples"("source_quote_id");

-- CreateIndex
CREATE INDEX "ix_samples__source_draft_id" ON "samples"("source_draft_id");

-- CreateIndex
CREATE INDEX "ix_samples__previous_sample_id" ON "samples"("previous_sample_id");

-- CreateIndex
CREATE INDEX "ix_samples__approved_proof_id" ON "samples"("approved_proof_id");

-- CreateIndex
CREATE INDEX "ix_samples__credit_order_id" ON "samples"("credit_order_id");

-- CreateIndex
CREATE INDEX "ix_samples__quoted_by" ON "samples"("quoted_by");

-- CreateIndex
CREATE INDEX "ix_samples__evidence_recorded_by" ON "samples"("evidence_recorded_by");

-- CreateIndex
CREATE INDEX "ix_samples__decided_by" ON "samples"("decided_by");

-- CreateIndex
CREATE INDEX "ix_samples__cancelled_by" ON "samples"("cancelled_by");

-- CreateIndex
CREATE INDEX "ix_samples__created_by" ON "samples"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_samples__one_live_attached" ON "samples"("order_id") WHERE ((kind = 'attached'::sample_kind) AND (status = ANY (ARRAY['requested'::sample_status, 'quoted'::sample_status, 'paid'::sample_status, 'in_production'::sample_status, 'shipped'::sample_status, 'delivered'::sample_status])));

-- CreateIndex
CREATE INDEX "ix_claims__sample_id" ON "claims"("sample_id");

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "fk_claims__sample_id" FOREIGN KEY ("sample_id") REFERENCES "samples"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "fk_samples__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "fk_samples__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "fk_samples__product_type_id" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "fk_samples__source_quote_id" FOREIGN KEY ("source_quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "fk_samples__source_draft_id" FOREIGN KEY ("source_draft_id") REFERENCES "configuration_drafts"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "fk_samples__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "fk_samples__order_line_id" FOREIGN KEY ("order_line_id") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "fk_samples__production_job_id" FOREIGN KEY ("production_job_id") REFERENCES "production_jobs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "fk_samples__quote_id" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "fk_samples__previous_sample_id" FOREIGN KEY ("previous_sample_id") REFERENCES "samples"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "fk_samples__quoted_by" FOREIGN KEY ("quoted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "fk_samples__evidence_recorded_by" FOREIGN KEY ("evidence_recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "fk_samples__decided_by" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "fk_samples__approved_proof_id" FOREIGN KEY ("approved_proof_id") REFERENCES "proofs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "fk_samples__bulk_quote_id" FOREIGN KEY ("bulk_quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "fk_samples__credit_order_id" FOREIGN KEY ("credit_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "fk_samples__cancelled_by" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "samples" ADD CONSTRAINT "fk_samples__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written checks (A-90).
ALTER TABLE samples
  ADD CONSTRAINT ck_samples__mockup_option CHECK (mockup_option <> 'none'),
  ADD CONSTRAINT ck_samples__quantity CHECK (quantity >= 1),
  ADD CONSTRAINT ck_samples__configuration CHECK (jsonb_typeof(configuration) = 'object'),
  ADD CONSTRAINT ck_samples__attached CHECK (kind <> 'attached' OR (order_id IS NOT NULL AND source_quote_id IS NULL AND source_draft_id IS NULL AND quote_id IS NULL)),
  ADD CONSTRAINT ck_samples__standalone CHECK (kind <> 'standalone' OR order_line_id IS NULL),
  ADD CONSTRAINT ck_samples__amounts CHECK ((sell_net_amount IS NULL OR sell_net_amount >= 0) AND (sell_gross_amount IS NULL OR sell_gross_amount >= 0) AND (buy_net_amount IS NULL OR buy_net_amount >= 0)),
  ADD CONSTRAINT ck_samples__quoted CHECK (status IN ('requested', 'cancelled', 'expired') OR (sell_net_amount IS NOT NULL AND quoted_at IS NOT NULL)),
  ADD CONSTRAINT ck_samples__measured CHECK ((measured_length_mm IS NULL OR measured_length_mm > 0) AND (measured_width_mm IS NULL OR measured_width_mm > 0) AND (measured_depth_mm IS NULL OR measured_depth_mm > 0)),
  ADD CONSTRAINT ck_samples__parcel CHECK (parcel_weight_g IS NULL OR parcel_weight_g > 0),
  ADD CONSTRAINT ck_samples__decided CHECK (status NOT IN ('approved', 'changes_requested', 'rejected') OR (decided_at IS NOT NULL AND decided_by IS NOT NULL)),
  ADD CONSTRAINT ck_samples__approved CHECK (status <> 'approved' OR approved_spec IS NOT NULL),
  ADD CONSTRAINT ck_samples__cancelled CHECK (status <> 'cancelled' OR (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL)),
  ADD CONSTRAINT ck_samples__credit CHECK (credit_order_id IS NULL OR (kind = 'standalone' AND credit_amount IS NOT NULL AND credit_amount >= 0));
ALTER TABLE factory_scorecards
  ADD CONSTRAINT ck_factory_scorecards__sample_jobs CHECK (sample_jobs_count >= 0);
