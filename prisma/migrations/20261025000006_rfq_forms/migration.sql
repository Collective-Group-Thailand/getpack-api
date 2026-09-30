-- U1 U-B0.1 slice 6 (schema-design A-54): the RFQ form's schema version per product type, and an opaque public id on
-- calculate logs so an RFQ routed from a calculation can name it (D-102 unmet demand). Existing rows get a new uuid.

-- AlterTable
ALTER TABLE "calculate_logs" ADD COLUMN     "public_id" UUID NOT NULL DEFAULT uuidv7();

-- AlterTable
ALTER TABLE "product_types" ADD COLUMN     "rfq_spec_schema_version" SMALLINT NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "ix_calculate_logs__public_id" ON "calculate_logs"("public_id");

