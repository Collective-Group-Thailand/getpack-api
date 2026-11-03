-- D-471 (agent portal pack, Phase 5): automatic lead capture. The inbound item keeps the signed-in customer it came
-- from, the idle studio design (one item per design), repeat signals and its PDPA basis (+ the marketing consent record
-- relied on); a dieline download without sign-in is logged by the SHA-256 of the browser's device id only.
-- Non-destructive (consent_basis backfilled from the source). Rollback: down.sql.
-- CreateEnum
CREATE TYPE "sales_inbound_consent_basis" AS ENUM ('enquiry', 'staff_entry', 'marketing_consent');

-- AlterTable
ALTER TABLE "dieline_downloads" ADD COLUMN     "device_hash" BYTEA,
ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "dieline_downloads" ADD CONSTRAINT "ck_dieline_downloads__user_or_device"
  CHECK (user_id IS NOT NULL OR device_hash IS NOT NULL);

-- AlterTable
ALTER TABLE "sales_inbound_leads" ADD COLUMN     "capture_user_id" BIGINT,
ADD COLUMN     "consent_basis" "sales_inbound_consent_basis",
ADD COLUMN     "consent_record_id" BIGINT,
ADD COLUMN     "design_document_id" BIGINT,
ADD COLUMN     "last_signal_at" TIMESTAMPTZ(6),
ADD COLUMN     "signal_count" INTEGER NOT NULL DEFAULT 1;
UPDATE "sales_inbound_leads" SET "consent_basis" = CASE WHEN "source" = 'manual' THEN 'staff_entry'::"sales_inbound_consent_basis" ELSE 'enquiry'::"sales_inbound_consent_basis" END;
ALTER TABLE "sales_inbound_leads" ALTER COLUMN "consent_basis" SET NOT NULL;
ALTER TABLE "sales_inbound_leads" ADD CONSTRAINT "ck_sales_inbound_leads__signal_count" CHECK (signal_count >= 1);

-- CreateIndex
CREATE INDEX "ix_dieline_downloads__device_hash" ON "dieline_downloads"("device_hash") WHERE (device_hash IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_inbound_leads__design_document_id" ON "sales_inbound_leads"("design_document_id");

-- CreateIndex
CREATE INDEX "ix_sales_inbound_leads__capture_user_id__source" ON "sales_inbound_leads"("capture_user_id", "source");

-- CreateIndex
CREATE INDEX "ix_sales_inbound_leads__consent_record_id" ON "sales_inbound_leads"("consent_record_id");

-- AddForeignKey
ALTER TABLE "sales_inbound_leads" ADD CONSTRAINT "fk_sales_inbound_leads__capture_user_id" FOREIGN KEY ("capture_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_inbound_leads" ADD CONSTRAINT "fk_sales_inbound_leads__design_document_id" FOREIGN KEY ("design_document_id") REFERENCES "design_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_inbound_leads" ADD CONSTRAINT "fk_sales_inbound_leads__consent_record_id" FOREIGN KEY ("consent_record_id") REFERENCES "consent_records"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
