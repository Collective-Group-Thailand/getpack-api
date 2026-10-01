-- U-B6 service, B2.3 Deliverable 2.3 (schema-design A-75): a factory's net buy cost per unit of a service item (a
-- `service` catalogue product). Legacy kept no service price table — CS typed the cost on `cs/service` (D-194); a line
-- here is the instant price path (D-100, D-043). Port map: docs/legacy/05-service-port-map.md §9.

-- AlterEnum
ALTER TYPE "price_component" ADD VALUE 'service_prices';

-- CreateTable
CREATE TABLE "pl_service_prices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "catalog_product_id" BIGINT NOT NULL,
    "unit_cost" DECIMAL(18,6) NOT NULL,
    "lead_time_days" DECIMAL(6,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_service_prices" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_pl_service_prices__print_type_id" ON "pl_service_prices"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_service_prices__catalog_product_id" ON "pl_service_prices"("catalog_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_service_prices__version__line_key" ON "pl_service_prices"("price_list_version_id", "line_key");

-- AddForeignKey
ALTER TABLE "pl_service_prices" ADD CONSTRAINT "fk_pl_service_prices__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_service_prices" ADD CONSTRAINT "fk_pl_service_prices__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_service_prices" ADD CONSTRAINT "fk_pl_service_prices__catalog_product_id" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- Hand-written (A-75)
ALTER TABLE pl_service_prices
  ADD CONSTRAINT ck_pl_service_prices__unit_cost CHECK (unit_cost > 0),
  ADD CONSTRAINT ck_pl_service_prices__lead_time CHECK (lead_time_days IS NULL OR lead_time_days >= 0);
CREATE TRIGGER tg_pl_service_prices__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_service_prices
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();
