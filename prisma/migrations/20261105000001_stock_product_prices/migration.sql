-- U-B6 standard product, B2.3 Deliverable 2.3 (schema-design A-74): the factory's buy price per piece of a stock product
-- by quantity band (legacy `standard_product_prices`, print type `std_product`). Port map:
-- docs/legacy/05-standard-product-port-map.md §9.

-- CreateTable
CREATE TABLE "pl_stock_product_prices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "price_list_version_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "print_type_id" BIGINT NOT NULL,
    "stock_product_id" BIGINT NOT NULL,
    "min_qty" INTEGER,
    "max_qty" INTEGER,
    "unit_buy_price" DECIMAL(18,6) NOT NULL,
    "lead_time_days" DECIMAL(6,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pl_stock_product_prices" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_pl_stock_product_prices__print_type_id" ON "pl_stock_product_prices"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_pl_stock_product_prices__stock_product_id" ON "pl_stock_product_prices"("stock_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pl_stock_product_prices__version__line_key" ON "pl_stock_product_prices"("price_list_version_id", "line_key");

-- AddForeignKey
ALTER TABLE "pl_stock_product_prices" ADD CONSTRAINT "fk_pl_stock_product_prices__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_stock_product_prices" ADD CONSTRAINT "fk_pl_stock_product_prices__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pl_stock_product_prices" ADD CONSTRAINT "fk_pl_stock_product_prices__stock_product_id" FOREIGN KEY ("stock_product_id") REFERENCES "stock_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- Hand-written (A-74)
ALTER TABLE pl_stock_product_prices
  ADD CONSTRAINT ck_pl_stock_product_prices__band CHECK ((min_qty IS NULL OR min_qty >= 0) AND (max_qty IS NULL OR max_qty >= COALESCE(min_qty, 0))),
  -- Legacy `calculateMargin` returns nothing for a price <= 0 and the request fails (port map S3).
  ADD CONSTRAINT ck_pl_stock_product_prices__price CHECK (unit_buy_price > 0),
  ADD CONSTRAINT ck_pl_stock_product_prices__lead_time CHECK (lead_time_days IS NULL OR lead_time_days >= 0);
CREATE TRIGGER tg_pl_stock_product_prices__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON pl_stock_product_prices
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_price_row_change();
