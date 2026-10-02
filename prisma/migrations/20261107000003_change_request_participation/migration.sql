-- U-B6 tail, tier-B envelopes (schema-design A-78, D-234): a factory asks for a tier / envelope change as a structured
-- change request (topic `participation_tier`): the product type, the tier asked for and, for tier B, the envelope. The
-- request changes nothing; staff apply it through the participation write.

-- AlterTable
ALTER TABLE "factory_change_requests" ADD COLUMN     "product_type_id" BIGINT,
ADD COLUMN     "proposed_envelope" JSONB,
ADD COLUMN     "proposed_tier" "participation_tier";

-- CreateIndex
CREATE INDEX "ix_factory_change_requests__product_type_id" ON "factory_change_requests"("product_type_id");

-- AddForeignKey
ALTER TABLE "factory_change_requests" ADD CONSTRAINT "fk_factory_change_requests__product_type_id" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written (A-78)
ALTER TABLE factory_change_requests
  ADD CONSTRAINT ck_factory_change_requests__participation CHECK (
    (product_type_id IS NULL AND proposed_tier IS NULL AND proposed_envelope IS NULL)
    OR (topic = 'participation_tier' AND product_type_id IS NOT NULL AND proposed_tier IS NOT NULL
        AND (proposed_envelope IS NULL OR (proposed_tier = 'B' AND jsonb_typeof(proposed_envelope) = 'object'))));
