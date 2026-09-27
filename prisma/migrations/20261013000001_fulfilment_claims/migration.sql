-- CreateEnum
CREATE TYPE "claim_type" AS ENUM ('damaged', 'wrong_spec', 'print_defect', 'quantity_short', 'late', 'other');

-- CreateEnum
CREATE TYPE "claim_origin" AS ENUM ('customer', 'tolerance_auto', 'staff');

-- CreateEnum
CREATE TYPE "claim_status" AS ENUM ('submitted', 'under_review', 'need_info', 'factory_review', 'approved', 'rejected', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "claim_resolution_kind" AS ENUM ('reprint', 'partial_refund', 'full_refund', 'credit');

-- CreateEnum
CREATE TYPE "claim_liability" AS ENUM ('factory', 'customer', 'carrier', 'packio', 'undetermined');

-- CreateEnum
CREATE TYPE "factory_claim_response" AS ENUM ('accepted', 'disputed');

-- CreateEnum
CREATE TYPE "claim_action" AS ENUM ('reproduction_job', 'refund', 'credit_note', 'store_credit', 'factory_deduction', 'carrier_recovery');

-- CreateTable
CREATE TABLE "claims" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "claim_no" TEXT NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "order_id" BIGINT NOT NULL,
    "shipment_id" BIGINT,
    "production_job_id" BIGINT,
    "customer_user_id" BIGINT NOT NULL,
    "type" "claim_type" NOT NULL,
    "origin" "claim_origin" NOT NULL,
    "status" "claim_status" NOT NULL DEFAULT 'submitted',
    "status_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "window_ends_at" TIMESTAMPTZ(6) NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requested_resolution" "claim_resolution_kind" NOT NULL,
    "claimed_quantity" INTEGER,
    "claimed_amount" DECIMAL(14,2),
    "liability" "claim_liability" NOT NULL DEFAULT 'undetermined',
    "liability_by_rule" "claim_liability" NOT NULL,
    "liability_overridden_by" BIGINT,
    "override_reason" TEXT,
    "factory_id" BIGINT,
    "factory_response" "factory_claim_response",
    "factory_response_note" TEXT,
    "factory_responded_at" TIMESTAMPTZ(6),
    "factory_responded_by" BIGINT,
    "info_request" TEXT,
    "info_response" TEXT,
    "decision_note" TEXT,
    "decided_by" BIGINT,
    "decided_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "created_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_claims" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_resolutions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "claim_id" BIGINT NOT NULL,
    "action" "claim_action" NOT NULL,
    "amount" DECIMAL(14,2),
    "quantity" INTEGER,
    "production_job_id" BIGINT,
    "refund_id" BIGINT,
    "customer_document_id" BIGINT,
    "vendor_deduction_id" BIGINT,
    "note" TEXT,
    "executed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executed_by" BIGINT NOT NULL,

    CONSTRAINT "pk_claim_resolutions" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_claims__public_id" ON "claims"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_claims__claim_no" ON "claims"("claim_no");

-- CreateIndex
CREATE INDEX "ix_claims__order_id" ON "claims"("order_id");

-- CreateIndex
CREATE INDEX "ix_claims__status__status_changed_at" ON "claims"("status", "status_changed_at");

-- CreateIndex
CREATE INDEX "ix_claims__factory_id__status" ON "claims"("factory_id", "status");

-- CreateIndex
CREATE INDEX "ix_claims__customer_user_id__created_at" ON "claims"("customer_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_claims__entity_id" ON "claims"("entity_id");

-- CreateIndex
CREATE INDEX "ix_claims__shipment_id" ON "claims"("shipment_id");

-- CreateIndex
CREATE INDEX "ix_claims__production_job_id" ON "claims"("production_job_id");

-- CreateIndex
CREATE INDEX "ix_claims__liability_overridden_by" ON "claims"("liability_overridden_by");

-- CreateIndex
CREATE INDEX "ix_claims__factory_responded_by" ON "claims"("factory_responded_by");

-- CreateIndex
CREATE INDEX "ix_claims__decided_by" ON "claims"("decided_by");

-- CreateIndex
CREATE INDEX "ix_claims__created_by" ON "claims"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_claim_resolutions__public_id" ON "claim_resolutions"("public_id");

-- CreateIndex
CREATE INDEX "ix_claim_resolutions__claim_id" ON "claim_resolutions"("claim_id");

-- CreateIndex
CREATE INDEX "ix_claim_resolutions__production_job_id" ON "claim_resolutions"("production_job_id");

-- CreateIndex
CREATE INDEX "ix_claim_resolutions__refund_id" ON "claim_resolutions"("refund_id");

-- CreateIndex
CREATE INDEX "ix_claim_resolutions__customer_document_id" ON "claim_resolutions"("customer_document_id");

-- CreateIndex
CREATE INDEX "ix_claim_resolutions__vendor_deduction_id" ON "claim_resolutions"("vendor_deduction_id");

-- CreateIndex
CREATE INDEX "ix_claim_resolutions__executed_by" ON "claim_resolutions"("executed_by");

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "fk_production_jobs__claim_id" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "delivery_reconciliations" ADD CONSTRAINT "fk_delivery_reconciliations__claim_id" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "fk_claims__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "fk_claims__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "fk_claims__shipment_id" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "fk_claims__production_job_id" FOREIGN KEY ("production_job_id") REFERENCES "production_jobs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "fk_claims__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "fk_claims__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "fk_claims__liability_overridden_by" FOREIGN KEY ("liability_overridden_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "fk_claims__factory_responded_by" FOREIGN KEY ("factory_responded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "fk_claims__decided_by" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "fk_claims__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "claim_resolutions" ADD CONSTRAINT "fk_claim_resolutions__claim_id" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "claim_resolutions" ADD CONSTRAINT "fk_claim_resolutions__production_job_id" FOREIGN KEY ("production_job_id") REFERENCES "production_jobs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "claim_resolutions" ADD CONSTRAINT "fk_claim_resolutions__refund_id" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "claim_resolutions" ADD CONSTRAINT "fk_claim_resolutions__executed_by" FOREIGN KEY ("executed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- =====================================================================================================
-- Hand-written: claims and their resolutions (D-080, D-082, D-083; schema-design §3.7, A-39)
-- =====================================================================================================
ALTER TABLE claims
  ADD CONSTRAINT ck_claims__claim_no CHECK (btrim(claim_no) <> ''),
  ADD CONSTRAINT ck_claims__description CHECK (btrim(description) <> ''),
  -- D-082: a customer claims within the window after receipt; automatic and staff claims are not bound by it.
  ADD CONSTRAINT ck_claims__window CHECK (origin <> 'customer' OR submitted_at <= window_ends_at),
  ADD CONSTRAINT ck_claims__window_order CHECK (window_ends_at >= received_at),
  ADD CONSTRAINT ck_claims__claimed CHECK (
    (claimed_quantity IS NULL OR claimed_quantity > 0) AND (claimed_amount IS NULL OR claimed_amount >= 0)),
  -- D-083: an override of the rule's liability names who and why.
  ADD CONSTRAINT ck_claims__override CHECK (
    (liability_overridden_by IS NULL) = (override_reason IS NULL)
    AND (override_reason IS NULL OR btrim(override_reason) <> '')),
  ADD CONSTRAINT ck_claims__factory_response CHECK ((factory_response IS NULL) = (factory_responded_at IS NULL)),
  ADD CONSTRAINT ck_claims__factory_liable CHECK (liability <> 'factory' OR factory_id IS NOT NULL),
  ADD CONSTRAINT ck_claims__decided CHECK (
    status NOT IN ('approved', 'rejected', 'resolved') OR (decided_at IS NOT NULL AND decided_by IS NOT NULL)),
  ADD CONSTRAINT ck_claims__resolved CHECK (status <> 'resolved' OR resolved_at IS NOT NULL),
  ADD CONSTRAINT ck_claims__closed CHECK ((status = 'closed') = (closed_at IS NOT NULL));
CREATE TRIGGER tg_claims__no_delete BEFORE DELETE ON claims
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE claim_resolutions
  ADD CONSTRAINT ck_claim_resolutions__amount CHECK (amount IS NULL OR amount >= 0),
  ADD CONSTRAINT ck_claim_resolutions__quantity CHECK (quantity IS NULL OR quantity > 0),
  ADD CONSTRAINT ck_claim_resolutions__reproduction CHECK (action <> 'reproduction_job' OR production_job_id IS NOT NULL),
  ADD CONSTRAINT ck_claim_resolutions__refund CHECK (action <> 'refund' OR refund_id IS NOT NULL),
  ADD CONSTRAINT ck_claim_resolutions__money CHECK (
    action NOT IN ('credit_note', 'store_credit', 'factory_deduction', 'carrier_recovery') OR amount IS NOT NULL);
-- A resolution is a record of what was done; only the B5 document links are filled in later.
CREATE FUNCTION tg_claim_resolutions__write_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'claim resolutions are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'customer_document_id' - 'vendor_deduction_id')
       <> (to_jsonb(OLD) - 'customer_document_id' - 'vendor_deduction_id')
     OR (OLD.customer_document_id IS NOT NULL AND NEW.customer_document_id IS DISTINCT FROM OLD.customer_document_id)
     OR (OLD.vendor_deduction_id IS NOT NULL AND NEW.vendor_deduction_id IS DISTINCT FROM OLD.vendor_deduction_id) THEN
    RAISE EXCEPTION 'claim resolution % is write-once', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_claim_resolutions__write_once BEFORE UPDATE OR DELETE ON claim_resolutions
  FOR EACH ROW EXECUTE FUNCTION tg_claim_resolutions__write_once();
