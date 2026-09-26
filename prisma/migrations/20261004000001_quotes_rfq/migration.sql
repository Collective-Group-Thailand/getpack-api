-- B2.5 quotes, RFQ, unmet demand and document numbering (docs/schema-design.md §2.7, §3.5; D-051, D-100, D-102).

-- CreateEnum
CREATE TYPE "document_type" AS ENUM ('qt', 'iv', 'tr', 'rc', 'cn', 'dn', 'po', 'gr', 'bs', 'pv', 'wt', 'jv', 'order_group', 'job', 'claim', 'shipment', 'rfq');

-- CreateEnum
CREATE TYPE "sequence_reset" AS ENUM ('never', 'yearly', 'monthly');

-- CreateEnum
CREATE TYPE "quote_source" AS ENUM ('instant', 'rfq');

-- CreateEnum
CREATE TYPE "quote_status" AS ENUM ('calculated', 'saved', 'shared', 'converted', 'expired', 'superseded');

-- CreateEnum
CREATE TYPE "rfq_status" AS ENUM ('submitted', 'in_review', 'need_info', 'quoted', 'accepted', 'declined', 'expired');

-- CreateEnum
CREATE TYPE "message_visibility" AS ENUM ('customer', 'internal');

-- CreateEnum
CREATE TYPE "consultation_status" AS ENUM ('requested', 'responded', 'declined', 'expired');

-- CreateEnum
CREATE TYPE "rfq_quote_status" AS ENUM ('draft', 'sent', 'accepted', 'superseded', 'expired');

-- CreateEnum
CREATE TYPE "unmet_demand_source" AS ENUM ('rfq_declined', 'rfq_expired', 'no_price_path', 'capability_missing', 'capacity_limited');

-- CreateTable
CREATE TABLE "document_series" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "doc_type" "document_type" NOT NULL,
    "prefix" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "reset_period" "sequence_reset" NOT NULL,
    "is_gapless" BOOLEAN NOT NULL,
    "description" TEXT NOT NULL,
    "decision_refs" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_document_series" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "series_id" BIGINT NOT NULL,
    "period_key" TEXT NOT NULL,
    "next_value" BIGINT NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_document_sequences" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "quote_code" TEXT,
    "entity_id" BIGINT NOT NULL,
    "channel" "sales_channel" NOT NULL,
    "source" "quote_source" NOT NULL,
    "rfq_quote_id" BIGINT,
    "customer_user_id" BIGINT,
    "created_by" BIGINT,
    "anonymous_id" TEXT,
    "product_type_id" BIGINT NOT NULL,
    "catalog_product_id" BIGINT,
    "stock_product_id" BIGINT,
    "input" JSONB NOT NULL,
    "input_schema_version" SMALLINT NOT NULL,
    "calculator_version" TEXT NOT NULL,
    "config_refs" JSONB NOT NULL,
    "status" "quote_status" NOT NULL,
    "valid_until" TIMESTAMPTZ(6) NOT NULL,
    "share_token_hash" BYTEA,
    "shared_at" TIMESTAMPTZ(6),
    "pdf_file_id" BIGINT,
    "pdf_requested_at" TIMESTAMPTZ(6),
    "delivery_postcode" CHAR(5),
    "promotion_code" TEXT,
    "snapshot_sha256" BYTEA NOT NULL,
    "superseded_by_id" BIGINT,
    "converted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_quotes" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_options" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "quote_id" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" "product_unit" NOT NULL,
    "result" JSONB NOT NULL,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "shipping_amount" DECIMAL(14,2),
    "unit_price" DECIMAL(18,6) NOT NULL,
    "lead_time_days" SMALLINT,
    "earliest_ship_date" DATE,
    "tolerance_shortage_pct" DECIMAL(7,4),
    "tolerance_overage_pct" DECIMAL(7,4),
    "selected_factory_id" BIGINT,
    "price_list_version_id" BIGINT,
    "internal_breakdown" JSONB,
    "buy_cost_net" DECIMAL(14,2),
    "margin_pct" DECIMAL(9,4),
    "below_margin_floor" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_quote_options" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfqs" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "rfq_code" TEXT NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "channel" "sales_channel" NOT NULL,
    "customer_user_id" BIGINT NOT NULL,
    "created_by" BIGINT,
    "product_type_id" BIGINT NOT NULL,
    "spec" JSONB NOT NULL,
    "spec_schema_version" SMALLINT NOT NULL,
    "length_mm" DECIMAL(10,2),
    "width_mm" DECIMAL(10,2),
    "height_mm" DECIMAL(10,2),
    "target_date" DATE,
    "delivery_postcode" CHAR(5) NOT NULL,
    "province_id" BIGINT,
    "notes" TEXT NOT NULL DEFAULT '',
    "status" "rfq_status" NOT NULL DEFAULT 'submitted',
    "decline_reason_id" BIGINT,
    "decline_note" TEXT,
    "assigned_to_user_id" BIGINT,
    "sla_due_at" TIMESTAMPTZ(6),
    "first_response_at" TIMESTAMPTZ(6),
    "routed_from_calculate_log_id" BIGINT,
    "accepted_quote_id" BIGINT,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_rfqs" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_quantity_tiers" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "rfq_id" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "pk_rfq_quantity_tiers" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_messages" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "rfq_id" BIGINT NOT NULL,
    "author_user_id" BIGINT NOT NULL,
    "visibility" "message_visibility" NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_rfq_messages" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_factory_consultations" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "rfq_id" BIGINT NOT NULL,
    "factory_id" BIGINT NOT NULL,
    "requested_by" BIGINT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "consultation_status" NOT NULL DEFAULT 'requested',
    "response" JSONB,
    "responded_by" BIGINT,
    "responded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_rfq_factory_consultations" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_quotes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "rfq_id" BIGINT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "status" "rfq_quote_status" NOT NULL DEFAULT 'draft',
    "valid_until" TIMESTAMPTZ(6),
    "note" TEXT NOT NULL DEFAULT '',
    "created_by" BIGINT NOT NULL,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_rfq_quotes" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_quote_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "rfq_quote_id" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(18,6) NOT NULL,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "shipping_net_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lead_time_days" SMALLINT NOT NULL,
    "factory_id" BIGINT,
    "buy_unit_price" DECIMAL(18,6),
    "margin_pct" DECIMAL(9,4),
    "below_margin_floor" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "pk_rfq_quote_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unmet_demand_reasons" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_unmet_demand_reasons" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unmet_demand_records" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "unmet_demand_source" NOT NULL,
    "reason_id" BIGINT,
    "product_type_id" BIGINT NOT NULL,
    "spec_band" JSONB NOT NULL,
    "quantity_band" TEXT NOT NULL,
    "province_id" BIGINT,
    "rfq_id" BIGINT,
    "calculate_log_id" BIGINT,
    "domain_event_id" UUID,

    CONSTRAINT "pk_unmet_demand_records" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_document_series__public_id" ON "document_series"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_document_series__entity_id__doc_type" ON "document_series"("entity_id", "doc_type");

-- CreateIndex
CREATE UNIQUE INDEX "ux_document_sequences__series_id__period_key" ON "document_sequences"("series_id", "period_key");

-- CreateIndex
CREATE UNIQUE INDEX "ux_quotes__public_id" ON "quotes"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_quotes__quote_code" ON "quotes"("quote_code");

-- CreateIndex
CREATE UNIQUE INDEX "ux_quotes__rfq_quote_id" ON "quotes"("rfq_quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_quotes__share_token_hash" ON "quotes"("share_token_hash");

-- CreateIndex
CREATE INDEX "ix_quotes__customer_user_id__created_at" ON "quotes"("customer_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_quotes__status__valid_until" ON "quotes"("status", "valid_until");

-- CreateIndex
CREATE INDEX "ix_quotes__anonymous_id" ON "quotes"("anonymous_id");

-- CreateIndex
CREATE INDEX "ix_quotes__entity_id" ON "quotes"("entity_id");

-- CreateIndex
CREATE INDEX "ix_quotes__product_type_id" ON "quotes"("product_type_id");

-- CreateIndex
CREATE INDEX "ix_quotes__catalog_product_id" ON "quotes"("catalog_product_id");

-- CreateIndex
CREATE INDEX "ix_quotes__stock_product_id" ON "quotes"("stock_product_id");

-- CreateIndex
CREATE INDEX "ix_quotes__created_by" ON "quotes"("created_by");

-- CreateIndex
CREATE INDEX "ix_quotes__pdf_file_id" ON "quotes"("pdf_file_id");

-- CreateIndex
CREATE INDEX "ix_quotes__superseded_by_id" ON "quotes"("superseded_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_quote_options__public_id" ON "quote_options"("public_id");

-- CreateIndex
CREATE INDEX "ix_quote_options__selected_factory_id" ON "quote_options"("selected_factory_id");

-- CreateIndex
CREATE INDEX "ix_quote_options__price_list_version_id" ON "quote_options"("price_list_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_quote_options__quote_id__quantity" ON "quote_options"("quote_id", "quantity");

-- CreateIndex
CREATE UNIQUE INDEX "ux_rfqs__public_id" ON "rfqs"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_rfqs__rfq_code" ON "rfqs"("rfq_code");

-- CreateIndex
CREATE UNIQUE INDEX "ux_rfqs__accepted_quote_id" ON "rfqs"("accepted_quote_id");

-- CreateIndex
CREATE INDEX "ix_rfqs__customer_user_id__submitted_at" ON "rfqs"("customer_user_id", "submitted_at" DESC);

-- CreateIndex
CREATE INDEX "ix_rfqs__status__sla_due_at" ON "rfqs"("status", "sla_due_at");

-- CreateIndex
CREATE INDEX "ix_rfqs__assigned_to_user_id" ON "rfqs"("assigned_to_user_id");

-- CreateIndex
CREATE INDEX "ix_rfqs__entity_id" ON "rfqs"("entity_id");

-- CreateIndex
CREATE INDEX "ix_rfqs__product_type_id" ON "rfqs"("product_type_id");

-- CreateIndex
CREATE INDEX "ix_rfqs__province_id" ON "rfqs"("province_id");

-- CreateIndex
CREATE INDEX "ix_rfqs__decline_reason_id" ON "rfqs"("decline_reason_id");

-- CreateIndex
CREATE INDEX "ix_rfqs__created_by" ON "rfqs"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_rfq_quantity_tiers__rfq_id__quantity" ON "rfq_quantity_tiers"("rfq_id", "quantity");

-- CreateIndex
CREATE UNIQUE INDEX "ux_rfq_messages__public_id" ON "rfq_messages"("public_id");

-- CreateIndex
CREATE INDEX "ix_rfq_messages__rfq_id__created_at" ON "rfq_messages"("rfq_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_rfq_messages__author_user_id" ON "rfq_messages"("author_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_rfq_factory_consultations__public_id" ON "rfq_factory_consultations"("public_id");

-- CreateIndex
CREATE INDEX "ix_rfq_factory_consultations__factory_id__status" ON "rfq_factory_consultations"("factory_id", "status");

-- CreateIndex
CREATE INDEX "ix_rfq_factory_consultations__rfq_id" ON "rfq_factory_consultations"("rfq_id");

-- CreateIndex
CREATE INDEX "ix_rfq_factory_consultations__requested_by" ON "rfq_factory_consultations"("requested_by");

-- CreateIndex
CREATE INDEX "ix_rfq_factory_consultations__responded_by" ON "rfq_factory_consultations"("responded_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_rfq_factory_consultations__one_open" ON "rfq_factory_consultations"("rfq_id", "factory_id") WHERE (status = 'requested'::consultation_status);

-- CreateIndex
CREATE UNIQUE INDEX "ux_rfq_quotes__public_id" ON "rfq_quotes"("public_id");

-- CreateIndex
CREATE INDEX "ix_rfq_quotes__created_by" ON "rfq_quotes"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_rfq_quotes__rfq_id__version_no" ON "rfq_quotes"("rfq_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_rfq_quotes__one_open" ON "rfq_quotes"("rfq_id") WHERE (status = ANY (ARRAY['draft'::rfq_quote_status, 'sent'::rfq_quote_status]));

-- CreateIndex
CREATE INDEX "ix_rfq_quote_lines__factory_id" ON "rfq_quote_lines"("factory_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_rfq_quote_lines__rfq_quote_id__quantity" ON "rfq_quote_lines"("rfq_quote_id", "quantity");

-- CreateIndex
CREATE UNIQUE INDEX "ux_unmet_demand_reasons__code" ON "unmet_demand_reasons"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ux_unmet_demand_records__domain_event_id" ON "unmet_demand_records"("domain_event_id");

-- CreateIndex
CREATE INDEX "ix_unmet_demand_records__product_type_id__occurred_at" ON "unmet_demand_records"("product_type_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ix_unmet_demand_records__reason_id" ON "unmet_demand_records"("reason_id");

-- CreateIndex
CREATE INDEX "ix_unmet_demand_records__province_id" ON "unmet_demand_records"("province_id");

-- CreateIndex
CREATE INDEX "ix_unmet_demand_records__rfq_id" ON "unmet_demand_records"("rfq_id");

-- CreateIndex
CREATE INDEX "ix_calculate_logs__quote_id" ON "calculate_logs"("quote_id");

-- AddForeignKey
ALTER TABLE "document_series" ADD CONSTRAINT "fk_document_series__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_sequences" ADD CONSTRAINT "fk_document_sequences__series_id" FOREIGN KEY ("series_id") REFERENCES "document_series"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "calculate_logs" ADD CONSTRAINT "fk_calculate_logs__quote_id" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "fk_quotes__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "fk_quotes__rfq_quote_id" FOREIGN KEY ("rfq_quote_id") REFERENCES "rfq_quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "fk_quotes__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "fk_quotes__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "fk_quotes__product_type_id" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "fk_quotes__catalog_product_id" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "fk_quotes__stock_product_id" FOREIGN KEY ("stock_product_id") REFERENCES "stock_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "fk_quotes__pdf_file_id" FOREIGN KEY ("pdf_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "fk_quotes__superseded_by_id" FOREIGN KEY ("superseded_by_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "quote_options" ADD CONSTRAINT "fk_quote_options__quote_id" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "quote_options" ADD CONSTRAINT "fk_quote_options__selected_factory_id" FOREIGN KEY ("selected_factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "quote_options" ADD CONSTRAINT "fk_quote_options__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "fk_rfqs__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "fk_rfqs__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "fk_rfqs__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "fk_rfqs__assigned_to_user_id" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "fk_rfqs__product_type_id" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "fk_rfqs__province_id" FOREIGN KEY ("province_id") REFERENCES "geo_provinces"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "fk_rfqs__decline_reason_id" FOREIGN KEY ("decline_reason_id") REFERENCES "unmet_demand_reasons"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "fk_rfqs__accepted_quote_id" FOREIGN KEY ("accepted_quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfq_quantity_tiers" ADD CONSTRAINT "fk_rfq_quantity_tiers__rfq_id" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfq_messages" ADD CONSTRAINT "fk_rfq_messages__rfq_id" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfq_messages" ADD CONSTRAINT "fk_rfq_messages__author_user_id" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfq_factory_consultations" ADD CONSTRAINT "fk_rfq_factory_consultations__rfq_id" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfq_factory_consultations" ADD CONSTRAINT "fk_rfq_factory_consultations__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfq_factory_consultations" ADD CONSTRAINT "fk_rfq_factory_consultations__requested_by" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfq_factory_consultations" ADD CONSTRAINT "fk_rfq_factory_consultations__responded_by" FOREIGN KEY ("responded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfq_quotes" ADD CONSTRAINT "fk_rfq_quotes__rfq_id" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfq_quotes" ADD CONSTRAINT "fk_rfq_quotes__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfq_quote_lines" ADD CONSTRAINT "fk_rfq_quote_lines__rfq_quote_id" FOREIGN KEY ("rfq_quote_id") REFERENCES "rfq_quotes"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfq_quote_lines" ADD CONSTRAINT "fk_rfq_quote_lines__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "unmet_demand_records" ADD CONSTRAINT "fk_unmet_demand_records__reason_id" FOREIGN KEY ("reason_id") REFERENCES "unmet_demand_reasons"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "unmet_demand_records" ADD CONSTRAINT "fk_unmet_demand_records__product_type_id" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "unmet_demand_records" ADD CONSTRAINT "fk_unmet_demand_records__province_id" FOREIGN KEY ("province_id") REFERENCES "geo_provinces"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "unmet_demand_records" ADD CONSTRAINT "fk_unmet_demand_records__rfq_id" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- --- hand-written (Prisma cannot express these) --------------------------------------------------

-- --- document numbering (schema-design §2.7) ------------------------------------------------------
ALTER TABLE document_series
  ADD CONSTRAINT ck_document_series__prefix CHECK (prefix ~ '^[A-Z0-9-]{1,10}$'),
  ADD CONSTRAINT ck_document_series__format CHECK (format ~ '\{seq:[1-9][0-9]?\}'),
  ADD CONSTRAINT ck_document_series__decision_refs CHECK (cardinality(decision_refs) >= 1),
  -- A statutory series never skips a number (accounting-design §4); running codes may.
  ADD CONSTRAINT ck_document_series__gapless CHECK (is_gapless OR doc_type IN ('order_group', 'job', 'claim', 'shipment', 'rfq'));
ALTER TABLE document_sequences
  ADD CONSTRAINT ck_document_sequences__next_value CHECK (next_value >= 1),
  ADD CONSTRAINT ck_document_sequences__period_key CHECK (period_key ~ '^(all|[0-9]{4}|[0-9]{4}-[0-9]{2})$');

-- --- quotes (D-051, schema-design §2.2) -----------------------------------------------------------
ALTER TABLE quotes
  ADD CONSTRAINT ck_quotes__input_schema_version CHECK (input_schema_version > 0),
  ADD CONSTRAINT ck_quotes__postcode CHECK (delivery_postcode IS NULL OR delivery_postcode ~ '^[0-9]{5}$'),
  ADD CONSTRAINT ck_quotes__owner CHECK (customer_user_id IS NOT NULL OR anonymous_id IS NOT NULL OR created_by IS NOT NULL),
  ADD CONSTRAINT ck_quotes__source CHECK ((source = 'rfq') = (rfq_quote_id IS NOT NULL)),
  ADD CONSTRAINT ck_quotes__converted CHECK (status <> 'converted' OR converted_at IS NOT NULL),
  ADD CONSTRAINT ck_quotes__superseded CHECK (status <> 'superseded' OR superseded_by_id IS NOT NULL),
  ADD CONSTRAINT ck_quotes__sha CHECK (octet_length(snapshot_sha256) = 32),
  ADD CONSTRAINT ck_quotes__share_hash CHECK (share_token_hash IS NULL OR octet_length(share_token_hash) = 32);

-- The snapshot is write-once: only the lifecycle columns change after insert, a code or an owner is
-- set once, and a quote is never deleted.
CREATE FUNCTION tg_quotes__snapshot_write_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'quotes are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.entity_id <> OLD.entity_id OR NEW.channel <> OLD.channel OR NEW.source <> OLD.source
     OR NEW.rfq_quote_id IS DISTINCT FROM OLD.rfq_quote_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.anonymous_id IS DISTINCT FROM OLD.anonymous_id
     OR NEW.product_type_id <> OLD.product_type_id
     OR NEW.catalog_product_id IS DISTINCT FROM OLD.catalog_product_id
     OR NEW.stock_product_id IS DISTINCT FROM OLD.stock_product_id
     OR NEW.input <> OLD.input OR NEW.input_schema_version <> OLD.input_schema_version
     OR NEW.calculator_version <> OLD.calculator_version OR NEW.config_refs <> OLD.config_refs
     OR NEW.valid_until <> OLD.valid_until
     OR NEW.delivery_postcode IS DISTINCT FROM OLD.delivery_postcode
     OR NEW.promotion_code IS DISTINCT FROM OLD.promotion_code
     OR NEW.snapshot_sha256 <> OLD.snapshot_sha256
     OR NEW.created_at <> OLD.created_at
     OR (OLD.quote_code IS NOT NULL AND NEW.quote_code IS DISTINCT FROM OLD.quote_code)
     OR (OLD.customer_user_id IS NOT NULL AND NEW.customer_user_id IS DISTINCT FROM OLD.customer_user_id) THEN
    RAISE EXCEPTION 'quote % snapshot is write-once', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_quotes__snapshot_write_once BEFORE UPDATE OR DELETE ON quotes
  FOR EACH ROW EXECUTE FUNCTION tg_quotes__snapshot_write_once();

ALTER TABLE quote_options
  ADD CONSTRAINT ck_quote_options__quantity CHECK (quantity > 0),
  ADD CONSTRAINT ck_quote_options__amounts CHECK (
    net_amount >= 0 AND discount_amount >= 0 AND vat_amount >= 0 AND unit_price >= 0
    AND (shipping_amount IS NULL OR shipping_amount >= 0)
  ),
  ADD CONSTRAINT ck_quote_options__gross CHECK (gross_amount = net_amount - discount_amount + vat_amount),
  ADD CONSTRAINT ck_quote_options__tolerance CHECK (
    (tolerance_shortage_pct IS NULL OR tolerance_shortage_pct BETWEEN 0 AND 100)
    AND (tolerance_overage_pct IS NULL OR tolerance_overage_pct BETWEEN 0 AND 100)
  );

-- Options are part of the snapshot: insert-only.
CREATE FUNCTION tg_forbid_row_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END
$$;
CREATE TRIGGER tg_quote_options__append_only BEFORE UPDATE OR DELETE ON quote_options
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_row_change();

-- --- RFQ (D-100, D-043, D-102) --------------------------------------------------------------------
ALTER TABLE rfqs
  ADD CONSTRAINT ck_rfqs__spec_schema_version CHECK (spec_schema_version > 0),
  ADD CONSTRAINT ck_rfqs__postcode CHECK (delivery_postcode ~ '^[0-9]{5}$'),
  ADD CONSTRAINT ck_rfqs__dimensions CHECK (
    (length_mm IS NULL OR length_mm > 0) AND (width_mm IS NULL OR width_mm > 0) AND (height_mm IS NULL OR height_mm > 0)
  ),
  ADD CONSTRAINT ck_rfqs__declined CHECK (status <> 'declined' OR decline_reason_id IS NOT NULL),
  ADD CONSTRAINT ck_rfqs__accepted CHECK (status <> 'accepted' OR accepted_quote_id IS NOT NULL),
  ADD CONSTRAINT ck_rfqs__closed CHECK (status NOT IN ('accepted', 'declined', 'expired') OR closed_at IS NOT NULL);

ALTER TABLE rfq_quantity_tiers
  ADD CONSTRAINT ck_rfq_quantity_tiers__quantity CHECK (quantity > 0);

ALTER TABLE rfq_messages
  ADD CONSTRAINT ck_rfq_messages__body CHECK (btrim(body) <> '');
CREATE TRIGGER tg_rfq_messages__append_only BEFORE UPDATE OR DELETE ON rfq_messages
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_row_change();

ALTER TABLE rfq_factory_consultations
  ADD CONSTRAINT ck_rfq_factory_consultations__responded CHECK (
    status NOT IN ('responded', 'declined') OR (responded_at IS NOT NULL AND responded_by IS NOT NULL)
  ),
  ADD CONSTRAINT ck_rfq_factory_consultations__response CHECK (status <> 'responded' OR response IS NOT NULL);

ALTER TABLE rfq_quotes
  ADD CONSTRAINT ck_rfq_quotes__version_no CHECK (version_no > 0),
  ADD CONSTRAINT ck_rfq_quotes__sent CHECK (status = 'draft' OR (sent_at IS NOT NULL AND valid_until IS NOT NULL));

ALTER TABLE rfq_quote_lines
  ADD CONSTRAINT ck_rfq_quote_lines__quantity CHECK (quantity > 0),
  ADD CONSTRAINT ck_rfq_quote_lines__amounts CHECK (
    unit_price >= 0 AND net_amount >= 0 AND vat_amount >= 0 AND shipping_net_amount >= 0 AND lead_time_days >= 0
    AND (buy_unit_price IS NULL OR buy_unit_price >= 0)
  ),
  ADD CONSTRAINT ck_rfq_quote_lines__gross CHECK (gross_amount = net_amount + vat_amount);

-- Lines are written while the quotation is a draft and frozen once it is sent.
CREATE FUNCTION forbid_sent_rfq_quote_line_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  quote_status rfq_quote_status;
BEGIN
  SELECT status INTO quote_status FROM rfq_quotes
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.rfq_quote_id ELSE NEW.rfq_quote_id END;
  -- NULL: the draft itself is being deleted (cascade).
  IF quote_status IS NOT NULL AND quote_status <> 'draft' THEN
    RAISE EXCEPTION 'rfq_quote_lines of a % quotation cannot be changed', quote_status
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER tg_rfq_quote_lines__draft_only BEFORE INSERT OR UPDATE OR DELETE ON rfq_quote_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_sent_rfq_quote_line_change();

-- --- unmet demand (D-102) -------------------------------------------------------------------------
ALTER TABLE unmet_demand_reasons
  ADD CONSTRAINT ck_unmet_demand_reasons__code CHECK (code ~ '^[a-z][a-z0-9_]*$');
ALTER TABLE unmet_demand_records
  ADD CONSTRAINT ck_unmet_demand_records__quantity_band CHECK (btrim(quantity_band) <> '');
CREATE TRIGGER tg_unmet_demand_records__append_only BEFORE UPDATE OR DELETE ON unmet_demand_records
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_row_change();
