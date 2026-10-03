-- U2.7 (schema-design A-103; D-204, D-288): reorder suggestions per SKU, recomputed nightly.
-- CreateEnum
CREATE TYPE "reorder_suggestion_status" AS ENUM ('open', 'contacted', 'dismissed');

-- CreateTable
CREATE TABLE "reorder_suggestions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "sku_sha256" BYTEA NOT NULL,
    "customer_user_id" BIGINT,
    "company_id" BIGINT,
    "product_type_id" BIGINT NOT NULL,
    "last_order_id" BIGINT NOT NULL,
    "order_count" INTEGER NOT NULL,
    "average_interval_days" DECIMAL(8,2) NOT NULL,
    "last_lead_time_days" INTEGER NOT NULL,
    "next_need_on" DATE NOT NULL,
    "suggested_on" DATE NOT NULL,
    "suggested_quantity" INTEGER NOT NULL,
    "status" "reorder_suggestion_status" NOT NULL DEFAULT 'open',
    "setting_version_ids" JSONB NOT NULL,
    "computed_at" TIMESTAMPTZ(6) NOT NULL,
    "contacted_at" TIMESTAMPTZ(6),
    "contacted_by" BIGINT,
    "contact_note" TEXT,
    "dismissed_at" TIMESTAMPTZ(6),
    "dismissed_by" BIGINT,
    "reminded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_reorder_suggestions" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_reorder_suggestions__public_id" ON "reorder_suggestions"("public_id");

-- CreateIndex
CREATE INDEX "ix_reorder_suggestions__customer_user_id" ON "reorder_suggestions"("customer_user_id");

-- CreateIndex
CREATE INDEX "ix_reorder_suggestions__company_id" ON "reorder_suggestions"("company_id");

-- CreateIndex
CREATE INDEX "ix_reorder_suggestions__product_type_id" ON "reorder_suggestions"("product_type_id");

-- CreateIndex
CREATE INDEX "ix_reorder_suggestions__last_order_id" ON "reorder_suggestions"("last_order_id");

-- CreateIndex
CREATE INDEX "ix_reorder_suggestions__status__suggested_on" ON "reorder_suggestions"("status", "suggested_on");

-- CreateIndex
CREATE INDEX "ix_reorder_suggestions__contacted_by" ON "reorder_suggestions"("contacted_by");

-- CreateIndex
CREATE INDEX "ix_reorder_suggestions__dismissed_by" ON "reorder_suggestions"("dismissed_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_reorder_suggestions__sku_sha256" ON "reorder_suggestions"("sku_sha256");

-- AddForeignKey
ALTER TABLE "reorder_suggestions" ADD CONSTRAINT "fk_reorder_suggestions__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "reorder_suggestions" ADD CONSTRAINT "fk_reorder_suggestions__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "reorder_suggestions" ADD CONSTRAINT "fk_reorder_suggestions__product_type_id" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "reorder_suggestions" ADD CONSTRAINT "fk_reorder_suggestions__last_order_id" FOREIGN KEY ("last_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "reorder_suggestions" ADD CONSTRAINT "fk_reorder_suggestions__contacted_by" FOREIGN KEY ("contacted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "reorder_suggestions" ADD CONSTRAINT "fk_reorder_suggestions__dismissed_by" FOREIGN KEY ("dismissed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written checks (A-103).
ALTER TABLE reorder_suggestions
  ADD CONSTRAINT ck_reorder_suggestions__owner CHECK ((customer_user_id IS NULL) <> (company_id IS NULL)),
  ADD CONSTRAINT ck_reorder_suggestions__sku CHECK (octet_length(sku_sha256) = 32),
  ADD CONSTRAINT ck_reorder_suggestions__numbers CHECK (
    order_count >= 1 AND average_interval_days >= 0 AND last_lead_time_days >= 0 AND suggested_quantity >= 1),
  ADD CONSTRAINT ck_reorder_suggestions__setting_versions CHECK (jsonb_typeof(setting_version_ids) = 'object'),
  ADD CONSTRAINT ck_reorder_suggestions__contacted CHECK (status <> 'contacted' OR contacted_at IS NOT NULL),
  ADD CONSTRAINT ck_reorder_suggestions__dismissed CHECK (status <> 'dismissed' OR dismissed_at IS NOT NULL);
