-- U1 U-B0.2 slice 9 (schema-design A-63, D-229, D-230): delivery exception resolution, split lineage and
-- staff reviews of proofs of delivery.

-- CreateEnum
CREATE TYPE "pod_review_decision" AS ENUM ('accepted', 'rejected');

-- CreateEnum
CREATE TYPE "shipment_exception_resolution" AS ENUM ('retry', 'return', 'cancel');

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "exception_note" TEXT,
ADD COLUMN     "exception_resolution" "shipment_exception_resolution",
ADD COLUMN     "exception_resolved_at" TIMESTAMPTZ(6),
ADD COLUMN     "exception_resolved_by" BIGINT,
ADD COLUMN     "split_from_id" BIGINT;

-- CreateTable
CREATE TABLE "proof_of_delivery_reviews" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "proof_of_delivery_id" BIGINT NOT NULL,
    "decision" "pod_review_decision" NOT NULL,
    "note" TEXT,
    "reviewed_by" BIGINT NOT NULL,
    "reviewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_proof_of_delivery_reviews" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_proof_of_delivery_reviews__public_id" ON "proof_of_delivery_reviews"("public_id");

-- CreateIndex
CREATE INDEX "ix_proof_of_delivery_reviews__pod_id__reviewed_at" ON "proof_of_delivery_reviews"("proof_of_delivery_id", "reviewed_at");

-- CreateIndex
CREATE INDEX "ix_proof_of_delivery_reviews__reviewed_by" ON "proof_of_delivery_reviews"("reviewed_by");

-- CreateIndex
CREATE INDEX "ix_shipments__split_from_id" ON "shipments"("split_from_id");

-- CreateIndex
CREATE INDEX "ix_shipments__exception_resolved_by" ON "shipments"("exception_resolved_by");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "fk_shipments__split_from_id" FOREIGN KEY ("split_from_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "fk_shipments__exception_resolved_by" FOREIGN KEY ("exception_resolved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "proof_of_delivery_reviews" ADD CONSTRAINT "fk_proof_of_delivery_reviews__proof_of_delivery_id" FOREIGN KEY ("proof_of_delivery_id") REFERENCES "proofs_of_delivery"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "proof_of_delivery_reviews" ADD CONSTRAINT "fk_proof_of_delivery_reviews__reviewed_by" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- =====================================================================================================
-- Hand-written (A-63)
-- =====================================================================================================
ALTER TABLE shipments
  ADD CONSTRAINT ck_shipments__exception_resolution CHECK (
    (exception_resolution IS NULL) = (exception_resolved_at IS NULL)
    AND (exception_resolution IS NULL OR (exception_note IS NOT NULL AND btrim(exception_note) <> ''))),
  ADD CONSTRAINT ck_shipments__split_from CHECK (split_from_id IS NULL OR split_from_id <> id);

-- D-229: a rejection says why; reviews are evidence and never change.
ALTER TABLE proof_of_delivery_reviews
  ADD CONSTRAINT ck_proof_of_delivery_reviews__note CHECK (
    decision = 'accepted' OR (note IS NOT NULL AND btrim(note) <> ''));
CREATE TRIGGER tg_proof_of_delivery_reviews__append_only BEFORE UPDATE OR DELETE ON proof_of_delivery_reviews
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_row_change();
