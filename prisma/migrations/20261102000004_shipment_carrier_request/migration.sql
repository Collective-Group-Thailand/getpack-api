-- U1 U-B0.3 slice 10 (schema-design A-67): a factory asks Packio for a fallback carrier (D-013, D-114); Logistics books it.

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "carrier_request_reason" TEXT,
ADD COLUMN     "carrier_requested_at" TIMESTAMPTZ(6),
ADD COLUMN     "carrier_requested_by" BIGINT;

-- CreateIndex
CREATE INDEX "ix_shipments__carrier_requested_by" ON "shipments"("carrier_requested_by");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "fk_shipments__carrier_requested_by" FOREIGN KEY ("carrier_requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written (A-67)
ALTER TABLE shipments
  ADD CONSTRAINT ck_shipments__carrier_request CHECK (
    (carrier_requested_at IS NULL) = (carrier_request_reason IS NULL)
    AND (carrier_request_reason IS NULL OR btrim(carrier_request_reason) <> ''));
