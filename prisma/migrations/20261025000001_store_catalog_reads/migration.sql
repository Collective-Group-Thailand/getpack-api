-- U1 U-B0.1 slice 2 (schema-design A-50): FAQs linked to the catalogue products they answer (store.catalog.listProductFaqs),
-- and a trigram index so published FAQs appear in store search (StoreSearchHitKind faq).

-- CreateTable
CREATE TABLE "faq_catalog_product_links" (
    "faq_id" BIGINT NOT NULL,
    "catalog_product_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,

    CONSTRAINT "pk_faq_catalog_product_links" PRIMARY KEY ("faq_id","catalog_product_id")
);

-- CreateIndex
CREATE INDEX "ix_faq_catalog_product_links__catalog_product_id" ON "faq_catalog_product_links"("catalog_product_id");

-- CreateIndex
CREATE INDEX "ix_faqs__question_th_trgm" ON "faqs" USING GIN ("question_th" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "faq_catalog_product_links" ADD CONSTRAINT "fk_faq_catalog_product_links__faq_id" FOREIGN KEY ("faq_id") REFERENCES "faqs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "faq_catalog_product_links" ADD CONSTRAINT "fk_faq_catalog_product_links__catalog_product_id" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "faq_catalog_product_links" ADD CONSTRAINT "fk_faq_catalog_product_links__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

