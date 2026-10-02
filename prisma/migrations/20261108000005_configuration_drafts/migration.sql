-- U2.1 (schema-design A-83, D-185): draft configurations a signed-in customer keeps, resumes, shares and converts to a
-- quote or an RFQ; purged configurations.draft_retention_days (90) after the last change.

-- CreateEnum
CREATE TYPE "configuration_draft_status" AS ENUM ('open', 'converted');

-- CreateTable
CREATE TABLE "configuration_drafts" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_user_id" BIGINT NOT NULL,
    "product_type_id" BIGINT NOT NULL,
    "catalog_product_id" BIGINT,
    "title" TEXT,
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "completeness_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "missing_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "configuration_draft_status" NOT NULL DEFAULT 'open',
    "converted_quote_id" BIGINT,
    "converted_rfq_id" BIGINT,
    "share_token_hash" BYTEA,
    "shared_at" TIMESTAMPTZ(6),
    "share_expires_at" TIMESTAMPTZ(6),
    "last_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_configuration_drafts" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_configuration_drafts__public_id" ON "configuration_drafts"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_configuration_drafts__share_token_hash" ON "configuration_drafts"("share_token_hash");

-- CreateIndex
CREATE INDEX "ix_configuration_drafts__owner_user_id__status__last_changed_at" ON "configuration_drafts"("owner_user_id", "status", "last_changed_at");

-- CreateIndex
CREATE INDEX "ix_configuration_drafts__expires_at" ON "configuration_drafts"("expires_at");

-- CreateIndex
CREATE INDEX "ix_configuration_drafts__product_type_id" ON "configuration_drafts"("product_type_id");

-- CreateIndex
CREATE INDEX "ix_configuration_drafts__catalog_product_id" ON "configuration_drafts"("catalog_product_id");

-- CreateIndex
CREATE INDEX "ix_configuration_drafts__converted_quote_id" ON "configuration_drafts"("converted_quote_id");

-- CreateIndex
CREATE INDEX "ix_configuration_drafts__converted_rfq_id" ON "configuration_drafts"("converted_rfq_id");

-- AddForeignKey
ALTER TABLE "configuration_drafts" ADD CONSTRAINT "fk_configuration_drafts__owner_user_id" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "configuration_drafts" ADD CONSTRAINT "fk_configuration_drafts__product_type_id" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "configuration_drafts" ADD CONSTRAINT "fk_configuration_drafts__catalog_product_id" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "configuration_drafts" ADD CONSTRAINT "fk_configuration_drafts__converted_quote_id" FOREIGN KEY ("converted_quote_id") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "configuration_drafts" ADD CONSTRAINT "fk_configuration_drafts__converted_rfq_id" FOREIGN KEY ("converted_rfq_id") REFERENCES "rfqs"("id") ON DELETE SET NULL ON UPDATE RESTRICT;


-- Hand-written (A-83)
ALTER TABLE configuration_drafts
  ADD CONSTRAINT ck_configuration_drafts__completeness CHECK (completeness_pct >= 0 AND completeness_pct <= 100),
  ADD CONSTRAINT ck_configuration_drafts__converted CHECK (
    (status = 'open' AND converted_quote_id IS NULL AND converted_rfq_id IS NULL) OR status = 'converted'),
  ADD CONSTRAINT ck_configuration_drafts__share CHECK (
    (share_token_hash IS NULL AND share_expires_at IS NULL) OR (share_token_hash IS NOT NULL AND share_expires_at IS NOT NULL)),
  ADD CONSTRAINT ck_configuration_drafts__title CHECK (title IS NULL OR btrim(title) <> ''),
  ADD CONSTRAINT ck_configuration_drafts__configuration CHECK (jsonb_typeof(configuration) = 'object');
