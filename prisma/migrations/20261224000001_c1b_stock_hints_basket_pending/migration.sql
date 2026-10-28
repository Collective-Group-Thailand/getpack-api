-- C1b (owner decisions 2026-10-28, DECISIONS-STAGE-A §10).
-- §10.5: a stock product's "starting from" price = its unit price at the minimum orderable quantity (first price tier),
-- priced through the store pricing path and cached here like `catalog_price_hints` (no row = no price shown).
CREATE TABLE "stock_price_hints" (
    "stock_product_id" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(18,6) NOT NULL,
    "lead_time_days" INTEGER,
    "calculator_version" TEXT NOT NULL,
    "computed_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pk_stock_price_hints" PRIMARY KEY ("stock_product_id")
);

ALTER TABLE "stock_price_hints" ADD CONSTRAINT "fk_stock_price_hints__stock_product_id" FOREIGN KEY ("stock_product_id") REFERENCES "stock_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- §10.9: a basket line put in from the quote tray before its form is filled (product reference only).
ALTER TABLE "rfq_basket_items" ADD COLUMN "form_pending" BOOLEAN NOT NULL DEFAULT false;
