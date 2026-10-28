-- Products redesign C1 (DECISIONS-STAGE-A §4 "Quote basket: basket lines must keep the product reference"): an RFQ
-- remembers the catalogue or stock product the customer asked from, so CS sees "กล่องไปรษณีย์ X", not only its type.
-- Both nullable (requests from a category form name no product); never both.
ALTER TABLE "rfqs"
  ADD COLUMN "catalog_product_id" BIGINT,
  ADD COLUMN "stock_product_id" BIGINT;

ALTER TABLE "rfqs"
  ADD CONSTRAINT "fk_rfqs__catalog_product_id" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "fk_rfqs__stock_product_id" FOREIGN KEY ("stock_product_id") REFERENCES "stock_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT ck_rfqs__one_product CHECK (catalog_product_id IS NULL OR stock_product_id IS NULL);

CREATE INDEX "ix_rfqs__catalog_product_id" ON "rfqs"("catalog_product_id");
CREATE INDEX "ix_rfqs__stock_product_id" ON "rfqs"("stock_product_id");
