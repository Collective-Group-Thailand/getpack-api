-- U1 U-B0.3 slice 3 (schema-design A-65): staff saved list views, and trigram indexes for the admin search by code.

-- CreateTable
CREATE TABLE "saved_views" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_user_id" BIGINT NOT NULL,
    "resource" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "columns" TEXT[],
    "has_columns" BOOLEAN NOT NULL DEFAULT false,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_saved_views" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_saved_views__public_id" ON "saved_views"("public_id");

-- CreateIndex
CREATE INDEX "ix_saved_views__resource__shared" ON "saved_views"("resource", "shared");

-- CreateIndex
CREATE UNIQUE INDEX "ux_saved_views__owner_user_id__resource__name" ON "saved_views"("owner_user_id", "resource", "name");

-- CreateIndex
CREATE INDEX "ix_claims__claim_no_trgm" ON "claims" USING GIN ("claim_no" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ix_companies__legal_name_trgm" ON "companies" USING GIN ("legal_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ix_customer_profiles__customer_code_trgm" ON "customer_profiles" USING GIN ("customer_code" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ix_factories__legal_name_trgm" ON "factories" USING GIN ("legal_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ix_order_groups__group_code_trgm" ON "order_groups" USING GIN ("group_code" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ix_orders__order_code_trgm" ON "orders" USING GIN ("order_code" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ix_quotes__quote_code_trgm" ON "quotes" USING GIN ("quote_code" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ix_rfqs__rfq_code_trgm" ON "rfqs" USING GIN ("rfq_code" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ix_shipments__shipment_no_trgm" ON "shipments" USING GIN ("shipment_no" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "fk_saved_views__owner_user_id" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- =====================================================================================================
-- Hand-written (A-65)
-- =====================================================================================================
ALTER TABLE saved_views
  ADD CONSTRAINT ck_saved_views__resource CHECK (resource ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  ADD CONSTRAINT ck_saved_views__name CHECK (btrim(name) <> '' AND char_length(name) <= 100),
  ADD CONSTRAINT ck_saved_views__query CHECK (jsonb_typeof(query) = 'object'),
  ADD CONSTRAINT ck_saved_views__columns CHECK (has_columns OR cardinality(columns) = 0);
