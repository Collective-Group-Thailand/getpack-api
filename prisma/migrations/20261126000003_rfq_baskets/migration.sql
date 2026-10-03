-- U5.B3 (schema-design A-111; D-301): multi-item RFQ baskets.
-- CreateEnum
CREATE TYPE "rfq_basket_status" AS ENUM ('draft', 'submitted', 'discarded');

-- AlterEnum
ALTER TYPE "document_type" ADD VALUE 'rfq_basket';

-- AlterTable
ALTER TABLE "rfqs" ADD COLUMN     "basket_id" BIGINT;

-- CreateTable
CREATE TABLE "rfq_baskets" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "basket_code" TEXT,
    "customer_user_id" BIGINT NOT NULL,
    "channel" "sales_channel" NOT NULL DEFAULT 'web',
    "status" "rfq_basket_status" NOT NULL DEFAULT 'draft',
    "delivery_postcode" CHAR(5),
    "target_date" DATE,
    "notes" TEXT NOT NULL DEFAULT '',
    "conversation_id" BIGINT,
    "submitted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_rfq_baskets" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_basket_items" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "basket_id" BIGINT NOT NULL,
    "sort" SMALLINT NOT NULL DEFAULT 0,
    "product_type_id" BIGINT NOT NULL,
    "specification" JSONB NOT NULL,
    "design_document_version_id" BIGINT,
    "rfq_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_rfq_basket_items" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_rfq_baskets__public_id" ON "rfq_baskets"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_rfq_baskets__basket_code" ON "rfq_baskets"("basket_code");

-- CreateIndex
CREATE UNIQUE INDEX "ux_rfq_baskets__conversation_id" ON "rfq_baskets"("conversation_id");

-- CreateIndex
CREATE INDEX "ix_rfq_baskets__customer_user_id__created_at" ON "rfq_baskets"("customer_user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ux_rfq_baskets__one_draft" ON "rfq_baskets"("customer_user_id", "channel") WHERE (status = 'draft'::rfq_basket_status);

-- CreateIndex
CREATE UNIQUE INDEX "ux_rfq_basket_items__public_id" ON "rfq_basket_items"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_rfq_basket_items__rfq_id" ON "rfq_basket_items"("rfq_id");

-- CreateIndex
CREATE INDEX "ix_rfq_basket_items__basket_id__sort" ON "rfq_basket_items"("basket_id", "sort");

-- CreateIndex
CREATE INDEX "ix_rfq_basket_items__product_type_id" ON "rfq_basket_items"("product_type_id");

-- CreateIndex
CREATE INDEX "ix_rfq_basket_items__design_document_version_id" ON "rfq_basket_items"("design_document_version_id");

-- CreateIndex
CREATE INDEX "ix_rfqs__basket_id" ON "rfqs"("basket_id");

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "fk_rfqs__basket_id" FOREIGN KEY ("basket_id") REFERENCES "rfq_baskets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfq_baskets" ADD CONSTRAINT "fk_rfq_baskets__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfq_baskets" ADD CONSTRAINT "fk_rfq_baskets__conversation_id" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfq_basket_items" ADD CONSTRAINT "fk_rfq_basket_items__basket_id" FOREIGN KEY ("basket_id") REFERENCES "rfq_baskets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfq_basket_items" ADD CONSTRAINT "fk_rfq_basket_items__product_type_id" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfq_basket_items" ADD CONSTRAINT "fk_rfq_basket_items__design_document_version_id" FOREIGN KEY ("design_document_version_id") REFERENCES "design_document_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfq_basket_items" ADD CONSTRAINT "fk_rfq_basket_items__rfq_id" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written (A-111). Basket codes are references, gaps allowed (like RFQs); compared as text — the enum value is
-- added in this transaction.
ALTER TABLE document_series DROP CONSTRAINT ck_document_series__gapless;
ALTER TABLE document_series
  ADD CONSTRAINT ck_document_series__gapless CHECK (
    is_gapless OR doc_type::text IN (
      'order_group', 'order', 'customer', 'company', 'job', 'claim', 'shipment', 'rfq', 'support_ticket', 'rfq_basket'
    )
  );
ALTER TABLE rfq_baskets
  ADD CONSTRAINT ck_rfq_baskets__submitted CHECK (
    (status::text = 'draft') OR (status::text = 'discarded' AND basket_code IS NULL)
    OR (basket_code IS NOT NULL AND submitted_at IS NOT NULL AND delivery_postcode IS NOT NULL)),
  ADD CONSTRAINT ck_rfq_baskets__postcode CHECK (delivery_postcode IS NULL OR delivery_postcode ~ '^[0-9]{5}$');
ALTER TABLE rfq_basket_items
  ADD CONSTRAINT ck_rfq_basket_items__specification CHECK (jsonb_typeof(specification) = 'object');
CREATE TRIGGER tg_rfq_baskets__no_delete BEFORE DELETE ON rfq_baskets
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();
