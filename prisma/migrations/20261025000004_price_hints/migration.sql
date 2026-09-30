-- U1 U-B0.1 slice 4 (schema-design A-52, D-220): the reference configuration of a catalogue product and its cached
-- "starting from" price (the reference priced by the ported calculator; no row = no hint).

-- AlterTable
ALTER TABLE "catalog_products" ADD COLUMN     "reference_configuration" JSONB;

-- CreateTable
CREATE TABLE "catalog_price_hints" (
    "catalog_product_id" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(18,6) NOT NULL,
    "lead_time_days" INTEGER,
    "spec_summary" JSONB NOT NULL,
    "calculator_version" TEXT NOT NULL,
    "computed_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pk_catalog_price_hints" PRIMARY KEY ("catalog_product_id")
);

-- AddForeignKey
ALTER TABLE "catalog_price_hints" ADD CONSTRAINT "fk_catalog_price_hints__catalog_product_id" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

