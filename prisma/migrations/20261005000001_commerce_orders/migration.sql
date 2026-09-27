-- B3.1 customers, carts, order groups and orders (docs/schema-design.md §3.6; D-060, D-051, D-072, D-142, A-6, A-31).

-- CreateEnum
CREATE TYPE "customer_type" AS ENUM ('individual', 'juristic', 'government');

-- CreateEnum
CREATE TYPE "tax_type" AS ENUM ('individual', 'juristic', 'government');

-- CreateEnum
CREATE TYPE "creation_channel" AS ENUM ('self', 'cs', 'line_liff');

-- CreateEnum
CREATE TYPE "address_kind" AS ENUM ('delivery', 'billing');

-- CreateEnum
CREATE TYPE "branch_type" AS ENUM ('head_office', 'branch');

-- CreateEnum
CREATE TYPE "cart_status" AS ENUM ('active', 'checked_out', 'abandoned');

-- CreateEnum
CREATE TYPE "cart_code_status" AS ENUM ('validated', 'rejected');

-- CreateEnum
CREATE TYPE "design_option" AS ENUM ('own_file', 'online_designer', 'hired_design', 'free_design');

-- CreateEnum
CREATE TYPE "mockup_option" AS ENUM ('none', 'with_print', 'without_print');

-- CreateEnum
CREATE TYPE "order_group_status" AS ENUM ('pending_company_approval', 'waiting_payment', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('waiting_payment', 'paid_for_production', 'artwork_approved', 'in_production', 'shipping', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "artwork_status" AS ENUM ('awaiting_template', 'awaiting_upload', 'uploaded', 'in_review', 'proof_sent', 'changes_requested', 'approved');

-- CreateEnum
CREATE TYPE "production_start_mode" AS ENUM ('auto', 'manual_exception');

-- CreateEnum
CREATE TYPE "completion_mode" AS ENUM ('auto_after_days', 'customer_confirmed');

-- CreateEnum
CREATE TYPE "order_line_type" AS ENUM ('product', 'design_fee', 'structure_design_fee', 'mockup', 'plate', 'die_block', 'shipping', 'service', 'extra_revision');

-- CreateEnum
CREATE TYPE "revenue_category" AS ENUM ('made_to_order', 'standard_product', 'design_service', 'mockup', 'shipping', 'other_service');

-- CreateEnum
CREATE TYPE "tax_nature" AS ENUM ('sale_of_goods', 'hire_of_work');

-- CreateEnum
CREATE TYPE "discount_source" AS ENUM ('coupon', 'automatic_promotion', 'referral', 'cs_discount', 'discount_memo', 'company_discount', 'points_redemption');

-- CreateEnum
CREATE TYPE "cancel_reason_applies_to" AS ENUM ('customer', 'staff', 'system');

-- AlterEnum


ALTER TYPE "document_type" ADD VALUE 'order';
ALTER TYPE "document_type" ADD VALUE 'customer';

-- CreateTable
CREATE TABLE "customer_profiles" (
    "user_id" BIGINT NOT NULL,
    "customer_code" TEXT,
    "customer_type" "customer_type" NOT NULL DEFAULT 'individual',
    "first_touch" JSONB,
    "created_via" "creation_channel" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_customer_profiles" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" BIGINT NOT NULL,
    "kind" "address_kind" NOT NULL,
    "label" TEXT NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "subdistrict_id" BIGINT,
    "postcode" CHAR(5) NOT NULL,
    "province_id" BIGINT NOT NULL,
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_customer_addresses" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_profiles" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" BIGINT NOT NULL,
    "tax_type" "tax_type" NOT NULL,
    "name" TEXT NOT NULL,
    "tax_id" CHAR(13) NOT NULL,
    "branch_type" "branch_type" NOT NULL,
    "branch_code" CHAR(5) NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "subdistrict_id" BIGINT,
    "postcode" CHAR(5) NOT NULL,
    "province_id" BIGINT NOT NULL,
    "withholds_tax" BOOLEAN NOT NULL DEFAULT false,
    "document_email" CITEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_tax_profiles" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "customer_user_id" BIGINT NOT NULL,
    "created_by_cs_user_id" BIGINT,
    "channel" "sales_channel" NOT NULL,
    "status" "cart_status" NOT NULL DEFAULT 'active',
    "utm" JSONB,
    "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checked_out_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_carts" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "cart_id" BIGINT NOT NULL,
    "quote_id" BIGINT NOT NULL,
    "quote_option_id" BIGINT NOT NULL,
    "reorder_of_order_id" BIGINT,
    "quantity" INTEGER NOT NULL,
    "design_option" "design_option" NOT NULL,
    "design_note" TEXT,
    "mockup_option" "mockup_option" NOT NULL DEFAULT 'none',
    "net_amount" DECIMAL(14,2) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "shipping_amount" DECIMAL(14,2),
    "unit_price" DECIMAL(18,6) NOT NULL,
    "price_locked_until" TIMESTAMPTZ(6) NOT NULL,
    "repriced_at" TIMESTAMPTZ(6),
    "pending_quote_id" BIGINT,
    "pending_quote_option_id" BIGINT,
    "pending_price_diff" JSONB,
    "sort" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_cart_items" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_item_destinations" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "cart_item_id" BIGINT NOT NULL,
    "customer_address_id" BIGINT,
    "address_snapshot" JSONB NOT NULL,
    "quantity" INTEGER NOT NULL,
    "sort" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_cart_item_destinations" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_codes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "cart_id" BIGINT NOT NULL,
    "code" CITEXT NOT NULL,
    "status" "cart_code_status" NOT NULL,
    "reject_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_cart_codes" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_groups" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "group_code" TEXT NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "customer_user_id" BIGINT NOT NULL,
    "placed_by_user_id" BIGINT NOT NULL,
    "on_behalf_of_user_id" BIGINT,
    "cart_id" BIGINT,
    "channel" "sales_channel" NOT NULL,
    "status" "order_group_status" NOT NULL,
    "tax_profile_snapshot" JSONB,
    "billing_address_snapshot" JSONB,
    "po_number" TEXT,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "shipping_net_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "wht_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cash_amount" DECIMAL(14,2) NOT NULL,
    "points_redeemed" INTEGER NOT NULL DEFAULT 0,
    "points_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6),
    "placed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason_id" BIGINT,
    "cancel_note" TEXT,
    "cc_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cs_remarks" TEXT,
    "utm" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_order_groups" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "order_code" TEXT NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "order_group_id" BIGINT NOT NULL,
    "customer_user_id" BIGINT NOT NULL,
    "product_type_id" BIGINT NOT NULL,
    "catalog_product_id" BIGINT,
    "stock_product_id" BIGINT,
    "quote_id" BIGINT NOT NULL,
    "quote_option_id" BIGINT NOT NULL,
    "reorder_of_order_id" BIGINT,
    "status" "order_status" NOT NULL DEFAULT 'waiting_payment',
    "status_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "artwork_status" "artwork_status" NOT NULL,
    "design_option" "design_option" NOT NULL,
    "design_note" TEXT,
    "mockup_option" "mockup_option" NOT NULL DEFAULT 'none',
    "quantity_ordered" INTEGER NOT NULL,
    "quantity_delivered" INTEGER,
    "unit" "product_unit" NOT NULL,
    "tolerance_shortage_pct" DECIMAL(7,4),
    "tolerance_overage_pct" DECIMAL(7,4),
    "tax_nature" "tax_nature" NOT NULL,
    "pricing_snapshot" JSONB NOT NULL,
    "config_refs" JSONB NOT NULL,
    "snapshot_sha256" BYTEA NOT NULL,
    "pricing_revision" INTEGER NOT NULL DEFAULT 1,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "shipping_net_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "wht_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cash_amount" DECIMAL(14,2) NOT NULL,
    "lead_time_days" SMALLINT,
    "promised_ship_date" DATE,
    "confirmed_production_date" DATE,
    "paid_for_production_at" TIMESTAMPTZ(6),
    "artwork_approved_at" TIMESTAMPTZ(6),
    "production_started_at" TIMESTAMPTZ(6),
    "start_mode" "production_start_mode",
    "shipped_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "completion_mode" "completion_mode",
    "claim_window_ends_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason_id" BIGINT,
    "cancel_note" TEXT,
    "selected_factory_id" BIGINT,
    "buy_cost_net" DECIMAL(14,2),
    "margin_amount" DECIMAL(14,2),
    "margin_pct" DECIMAL(9,4),
    "below_margin_floor" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_orders" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" BIGINT NOT NULL,
    "line_no" SMALLINT NOT NULL,
    "line_type" "order_line_type" NOT NULL,
    "description_th" TEXT NOT NULL,
    "description_en" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" "product_unit" NOT NULL,
    "unit_price" DECIMAL(18,6) NOT NULL,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_rate_pct" DECIMAL(7,4) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "wht_category" "wht_category" NOT NULL,
    "wht_rate_pct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "wht_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "revenue_category" "revenue_category" NOT NULL,
    "tax_nature" "tax_nature" NOT NULL,
    "is_reusable_tooling" BOOLEAN NOT NULL DEFAULT false,
    "waived_reason" TEXT,
    "buy_cost_net" DECIMAL(14,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_order_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_discounts" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "order_id" BIGINT NOT NULL,
    "order_line_id" BIGINT,
    "source" "discount_source" NOT NULL,
    "granted_by_user_id" BIGINT,
    "pct" DECIMAL(7,4),
    "amount" DECIMAL(14,2) NOT NULL,
    "capped_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cap_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_order_discounts" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_destinations" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" BIGINT NOT NULL,
    "customer_address_id" BIGINT,
    "recipient_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "subdistrict_id" BIGINT,
    "postcode" CHAR(5) NOT NULL,
    "province_id" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "shipping_net_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sort" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_order_destinations" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_notes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" BIGINT NOT NULL,
    "author_user_id" BIGINT NOT NULL,
    "body" TEXT NOT NULL,
    "mentions" BIGINT[] DEFAULT ARRAY[]::BIGINT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_order_notes" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_price_revisions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "order_id" BIGINT NOT NULL,
    "revision" INTEGER NOT NULL,
    "previous_snapshot" JSONB NOT NULL,
    "previous_lines" JSONB NOT NULL,
    "previous_gross" DECIMAL(14,2) NOT NULL,
    "new_gross" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,

    CONSTRAINT "pk_order_price_revisions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_cancel_reasons" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "applies_to" "cancel_reason_applies_to" NOT NULL,
    "requires_credit_note" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_order_cancel_reasons" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_customer_profiles__customer_code" ON "customer_profiles"("customer_code");

-- CreateIndex
CREATE INDEX "ix_customer_profiles__created_by" ON "customer_profiles"("created_by");

-- CreateIndex
CREATE INDEX "ix_customer_profiles__updated_by" ON "customer_profiles"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_customer_addresses__public_id" ON "customer_addresses"("public_id");

-- CreateIndex
CREATE INDEX "ix_customer_addresses__user_id__kind" ON "customer_addresses"("user_id", "kind");

-- CreateIndex
CREATE INDEX "ix_customer_addresses__subdistrict_id" ON "customer_addresses"("subdistrict_id");

-- CreateIndex
CREATE INDEX "ix_customer_addresses__province_id" ON "customer_addresses"("province_id");

-- CreateIndex
CREATE INDEX "ix_customer_addresses__created_by" ON "customer_addresses"("created_by");

-- CreateIndex
CREATE INDEX "ix_customer_addresses__updated_by" ON "customer_addresses"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_tax_profiles__public_id" ON "tax_profiles"("public_id");

-- CreateIndex
CREATE INDEX "ix_tax_profiles__user_id" ON "tax_profiles"("user_id");

-- CreateIndex
CREATE INDEX "ix_tax_profiles__subdistrict_id" ON "tax_profiles"("subdistrict_id");

-- CreateIndex
CREATE INDEX "ix_tax_profiles__province_id" ON "tax_profiles"("province_id");

-- CreateIndex
CREATE INDEX "ix_tax_profiles__created_by" ON "tax_profiles"("created_by");

-- CreateIndex
CREATE INDEX "ix_tax_profiles__updated_by" ON "tax_profiles"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_carts__public_id" ON "carts"("public_id");

-- CreateIndex
CREATE INDEX "ix_carts__customer_user_id__status" ON "carts"("customer_user_id", "status");

-- CreateIndex
CREATE INDEX "ix_carts__entity_id" ON "carts"("entity_id");

-- CreateIndex
CREATE INDEX "ix_carts__created_by_cs_user_id" ON "carts"("created_by_cs_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_cart_items__public_id" ON "cart_items"("public_id");

-- CreateIndex
CREATE INDEX "ix_cart_items__cart_id" ON "cart_items"("cart_id");

-- CreateIndex
CREATE INDEX "ix_cart_items__quote_id" ON "cart_items"("quote_id");

-- CreateIndex
CREATE INDEX "ix_cart_items__quote_option_id" ON "cart_items"("quote_option_id");

-- CreateIndex
CREATE INDEX "ix_cart_items__reorder_of_order_id" ON "cart_items"("reorder_of_order_id");

-- CreateIndex
CREATE INDEX "ix_cart_items__pending_quote_id" ON "cart_items"("pending_quote_id");

-- CreateIndex
CREATE INDEX "ix_cart_items__pending_quote_option_id" ON "cart_items"("pending_quote_option_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_cart_item_destinations__public_id" ON "cart_item_destinations"("public_id");

-- CreateIndex
CREATE INDEX "ix_cart_item_destinations__cart_item_id" ON "cart_item_destinations"("cart_item_id");

-- CreateIndex
CREATE INDEX "ix_cart_item_destinations__customer_address_id" ON "cart_item_destinations"("customer_address_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_cart_codes__cart_id__code" ON "cart_codes"("cart_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ux_order_groups__public_id" ON "order_groups"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_order_groups__group_code" ON "order_groups"("group_code");

-- CreateIndex
CREATE INDEX "ix_order_groups__customer_user_id__placed_at" ON "order_groups"("customer_user_id", "placed_at" DESC);

-- CreateIndex
CREATE INDEX "ix_order_groups__status__placed_at" ON "order_groups"("status", "placed_at" DESC);

-- CreateIndex
CREATE INDEX "ix_order_groups__entity_id" ON "order_groups"("entity_id");

-- CreateIndex
CREATE INDEX "ix_order_groups__placed_by_user_id" ON "order_groups"("placed_by_user_id");

-- CreateIndex
CREATE INDEX "ix_order_groups__on_behalf_of_user_id" ON "order_groups"("on_behalf_of_user_id");

-- CreateIndex
CREATE INDEX "ix_order_groups__cart_id" ON "order_groups"("cart_id");

-- CreateIndex
CREATE INDEX "ix_order_groups__cancel_reason_id" ON "order_groups"("cancel_reason_id");

-- CreateIndex
CREATE INDEX "ix_order_groups__updated_by" ON "order_groups"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_orders__public_id" ON "orders"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_orders__order_code" ON "orders"("order_code");

-- CreateIndex
CREATE INDEX "ix_orders__order_group_id" ON "orders"("order_group_id");

-- CreateIndex
CREATE INDEX "ix_orders__status__promised_ship_date" ON "orders"("status", "promised_ship_date");

-- CreateIndex
CREATE INDEX "ix_orders__customer_user_id__created_at" ON "orders"("customer_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_orders__artwork_status" ON "orders"("artwork_status");

-- CreateIndex
CREATE INDEX "ix_orders__entity_id" ON "orders"("entity_id");

-- CreateIndex
CREATE INDEX "ix_orders__product_type_id" ON "orders"("product_type_id");

-- CreateIndex
CREATE INDEX "ix_orders__catalog_product_id" ON "orders"("catalog_product_id");

-- CreateIndex
CREATE INDEX "ix_orders__stock_product_id" ON "orders"("stock_product_id");

-- CreateIndex
CREATE INDEX "ix_orders__quote_id" ON "orders"("quote_id");

-- CreateIndex
CREATE INDEX "ix_orders__quote_option_id" ON "orders"("quote_option_id");

-- CreateIndex
CREATE INDEX "ix_orders__reorder_of_order_id" ON "orders"("reorder_of_order_id");

-- CreateIndex
CREATE INDEX "ix_orders__cancel_reason_id" ON "orders"("cancel_reason_id");

-- CreateIndex
CREATE INDEX "ix_orders__selected_factory_id" ON "orders"("selected_factory_id");

-- CreateIndex
CREATE INDEX "ix_orders__updated_by" ON "orders"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_order_lines__public_id" ON "order_lines"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_order_lines__order_id__line_no" ON "order_lines"("order_id", "line_no");

-- CreateIndex
CREATE INDEX "ix_order_discounts__order_id" ON "order_discounts"("order_id");

-- CreateIndex
CREATE INDEX "ix_order_discounts__order_line_id" ON "order_discounts"("order_line_id");

-- CreateIndex
CREATE INDEX "ix_order_discounts__granted_by_user_id" ON "order_discounts"("granted_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_order_destinations__public_id" ON "order_destinations"("public_id");

-- CreateIndex
CREATE INDEX "ix_order_destinations__order_id" ON "order_destinations"("order_id");

-- CreateIndex
CREATE INDEX "ix_order_destinations__customer_address_id" ON "order_destinations"("customer_address_id");

-- CreateIndex
CREATE INDEX "ix_order_destinations__subdistrict_id" ON "order_destinations"("subdistrict_id");

-- CreateIndex
CREATE INDEX "ix_order_destinations__province_id" ON "order_destinations"("province_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_order_notes__public_id" ON "order_notes"("public_id");

-- CreateIndex
CREATE INDEX "ix_order_notes__order_id__created_at" ON "order_notes"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_order_notes__author_user_id" ON "order_notes"("author_user_id");

-- CreateIndex
CREATE INDEX "ix_order_price_revisions__created_by" ON "order_price_revisions"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_order_price_revisions__order_id__revision" ON "order_price_revisions"("order_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "ux_order_cancel_reasons__code" ON "order_cancel_reasons"("code");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "fk_stock_movements__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "fk_customer_profiles__user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "fk_customer_profiles__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "fk_customer_profiles__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "fk_customer_addresses__user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "fk_customer_addresses__subdistrict_id" FOREIGN KEY ("subdistrict_id") REFERENCES "geo_subdistricts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "fk_customer_addresses__province_id" FOREIGN KEY ("province_id") REFERENCES "geo_provinces"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "fk_customer_addresses__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "fk_customer_addresses__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tax_profiles" ADD CONSTRAINT "fk_tax_profiles__user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tax_profiles" ADD CONSTRAINT "fk_tax_profiles__subdistrict_id" FOREIGN KEY ("subdistrict_id") REFERENCES "geo_subdistricts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tax_profiles" ADD CONSTRAINT "fk_tax_profiles__province_id" FOREIGN KEY ("province_id") REFERENCES "geo_provinces"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tax_profiles" ADD CONSTRAINT "fk_tax_profiles__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tax_profiles" ADD CONSTRAINT "fk_tax_profiles__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "fk_carts__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "fk_carts__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "fk_carts__created_by_cs_user_id" FOREIGN KEY ("created_by_cs_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "fk_cart_items__cart_id" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "fk_cart_items__quote_id" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "fk_cart_items__quote_option_id" FOREIGN KEY ("quote_option_id") REFERENCES "quote_options"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "fk_cart_items__reorder_of_order_id" FOREIGN KEY ("reorder_of_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "fk_cart_items__pending_quote_id" FOREIGN KEY ("pending_quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "fk_cart_items__pending_quote_option_id" FOREIGN KEY ("pending_quote_option_id") REFERENCES "quote_options"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "cart_item_destinations" ADD CONSTRAINT "fk_cart_item_destinations__cart_item_id" FOREIGN KEY ("cart_item_id") REFERENCES "cart_items"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "cart_item_destinations" ADD CONSTRAINT "fk_cart_item_destinations__customer_address_id" FOREIGN KEY ("customer_address_id") REFERENCES "customer_addresses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "cart_codes" ADD CONSTRAINT "fk_cart_codes__cart_id" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_groups" ADD CONSTRAINT "fk_order_groups__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_groups" ADD CONSTRAINT "fk_order_groups__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_groups" ADD CONSTRAINT "fk_order_groups__placed_by_user_id" FOREIGN KEY ("placed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_groups" ADD CONSTRAINT "fk_order_groups__on_behalf_of_user_id" FOREIGN KEY ("on_behalf_of_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_groups" ADD CONSTRAINT "fk_order_groups__cart_id" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_groups" ADD CONSTRAINT "fk_order_groups__cancel_reason_id" FOREIGN KEY ("cancel_reason_id") REFERENCES "order_cancel_reasons"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_groups" ADD CONSTRAINT "fk_order_groups__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "fk_orders__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "fk_orders__order_group_id" FOREIGN KEY ("order_group_id") REFERENCES "order_groups"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "fk_orders__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "fk_orders__product_type_id" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "fk_orders__catalog_product_id" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "fk_orders__stock_product_id" FOREIGN KEY ("stock_product_id") REFERENCES "stock_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "fk_orders__quote_id" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "fk_orders__quote_option_id" FOREIGN KEY ("quote_option_id") REFERENCES "quote_options"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "fk_orders__reorder_of_order_id" FOREIGN KEY ("reorder_of_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "fk_orders__cancel_reason_id" FOREIGN KEY ("cancel_reason_id") REFERENCES "order_cancel_reasons"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "fk_orders__selected_factory_id" FOREIGN KEY ("selected_factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "fk_orders__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "fk_order_lines__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_discounts" ADD CONSTRAINT "fk_order_discounts__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_discounts" ADD CONSTRAINT "fk_order_discounts__order_line_id" FOREIGN KEY ("order_line_id") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_discounts" ADD CONSTRAINT "fk_order_discounts__granted_by_user_id" FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_destinations" ADD CONSTRAINT "fk_order_destinations__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_destinations" ADD CONSTRAINT "fk_order_destinations__customer_address_id" FOREIGN KEY ("customer_address_id") REFERENCES "customer_addresses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_destinations" ADD CONSTRAINT "fk_order_destinations__subdistrict_id" FOREIGN KEY ("subdistrict_id") REFERENCES "geo_subdistricts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_destinations" ADD CONSTRAINT "fk_order_destinations__province_id" FOREIGN KEY ("province_id") REFERENCES "geo_provinces"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_notes" ADD CONSTRAINT "fk_order_notes__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_notes" ADD CONSTRAINT "fk_order_notes__author_user_id" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_price_revisions" ADD CONSTRAINT "fk_order_price_revisions__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_price_revisions" ADD CONSTRAINT "fk_order_price_revisions__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- --- hand-written (Prisma cannot express these) --------------------------------------------------

-- --- document numbering: running codes for orders and customers (Q-2, not gapless) ----------------
-- Compared as text: enum values added in this migration cannot be used as enum literals before commit.
ALTER TABLE document_series DROP CONSTRAINT ck_document_series__gapless;
ALTER TABLE document_series
  ADD CONSTRAINT ck_document_series__gapless CHECK (
    is_gapless OR doc_type::text IN ('order_group', 'order', 'customer', 'job', 'claim', 'shipment', 'rfq')
  );

-- A row that is part of an issued business record is never deleted (schema-design §1.6).
CREATE FUNCTION tg_forbid_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are never deleted', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END
$$;

-- --- customers (PII, schema-design §2.11) ---------------------------------------------------------
ALTER TABLE customer_profiles
  ADD CONSTRAINT ck_customer_profiles__customer_code CHECK (customer_code IS NULL OR btrim(customer_code) <> '');

ALTER TABLE customer_addresses
  ADD CONSTRAINT ck_customer_addresses__postcode CHECK (postcode ~ '^[0-9]{5}$'),
  ADD CONSTRAINT ck_customer_addresses__phone_e164 CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT ck_customer_addresses__text CHECK (
    btrim(label) <> '' AND btrim(recipient_name) <> '' AND btrim(line1) <> ''
  ),
  ADD CONSTRAINT ck_customer_addresses__lat_lng CHECK (
    (lat IS NULL) = (lng IS NULL) AND (lat IS NULL OR (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180))
  );
CREATE UNIQUE INDEX ux_customer_addresses__one_default ON customer_addresses (user_id, kind)
  WHERE is_default AND deleted_at IS NULL;

ALTER TABLE tax_profiles
  ADD CONSTRAINT ck_tax_profiles__tax_id CHECK (tax_id ~ '^[0-9]{13}$'),
  ADD CONSTRAINT ck_tax_profiles__branch_code CHECK (branch_code ~ '^[0-9]{5}$'),
  -- Head office is branch 00000 (schema-design §1.3); a branch never uses it.
  ADD CONSTRAINT ck_tax_profiles__branch CHECK ((branch_type = 'head_office') = (branch_code = '00000')),
  ADD CONSTRAINT ck_tax_profiles__postcode CHECK (postcode ~ '^[0-9]{5}$'),
  ADD CONSTRAINT ck_tax_profiles__text CHECK (btrim(name) <> '' AND btrim(line1) <> '');
CREATE UNIQUE INDEX ux_tax_profiles__one_default ON tax_profiles (user_id)
  WHERE is_default AND deleted_at IS NULL;

-- --- carts (D-051) --------------------------------------------------------------------------------
ALTER TABLE carts
  ADD CONSTRAINT ck_carts__checked_out CHECK ((status = 'checked_out') = (checked_out_at IS NOT NULL));
CREATE UNIQUE INDEX ux_carts__one_active ON carts (customer_user_id, channel) WHERE status = 'active';

ALTER TABLE cart_items
  ADD CONSTRAINT ck_cart_items__quantity CHECK (quantity > 0),
  ADD CONSTRAINT ck_cart_items__amounts CHECK (
    net_amount >= 0 AND vat_amount >= 0 AND unit_price >= 0 AND (shipping_amount IS NULL OR shipping_amount >= 0)
  ),
  ADD CONSTRAINT ck_cart_items__gross CHECK (gross_amount = net_amount + vat_amount),
  -- A re-priced option waits for the client with its diff, or nothing is pending.
  ADD CONSTRAINT ck_cart_items__pending CHECK (
    num_nonnulls(pending_quote_id, pending_quote_option_id, pending_price_diff) IN (0, 3)
  );

ALTER TABLE cart_item_destinations
  ADD CONSTRAINT ck_cart_item_destinations__quantity CHECK (quantity > 0);

-- --- order groups & orders (A-6, D-060) -----------------------------------------------------------
ALTER TABLE order_groups
  ADD CONSTRAINT ck_order_groups__amounts CHECK (
    net_amount >= 0 AND discount_amount >= 0 AND shipping_net_amount >= 0 AND vat_amount >= 0
    AND wht_amount >= 0 AND points_redeemed >= 0 AND points_value >= 0 AND shipping_net_amount <= net_amount
  ),
  ADD CONSTRAINT ck_order_groups__gross CHECK (gross_amount = net_amount - discount_amount + vat_amount),
  ADD CONSTRAINT ck_order_groups__cash CHECK (cash_amount = gross_amount - wht_amount),
  ADD CONSTRAINT ck_order_groups__cancelled CHECK (
    (status = 'cancelled') = (cancelled_at IS NOT NULL) AND (status <> 'cancelled' OR cancel_reason_id IS NOT NULL)
  ),
  ADD CONSTRAINT ck_order_groups__po_number CHECK (po_number IS NULL OR btrim(po_number) <> ''),
  ADD CONSTRAINT ck_order_groups__cc_emails CHECK (cardinality(cc_emails) <= 10);
-- The per-minute unpaid-expiry job (D-060) reads only groups still waiting for payment.
CREATE INDEX ix_order_groups__expires_at ON order_groups (expires_at) WHERE status = 'waiting_payment';
CREATE TRIGGER tg_order_groups__no_delete BEFORE DELETE ON order_groups
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE orders
  ADD CONSTRAINT ck_orders__quantity CHECK (
    quantity_ordered > 0 AND (quantity_delivered IS NULL OR quantity_delivered >= 0)
  ),
  ADD CONSTRAINT ck_orders__amounts CHECK (
    net_amount >= 0 AND discount_amount >= 0 AND shipping_net_amount >= 0 AND vat_amount >= 0
    AND wht_amount >= 0 AND shipping_net_amount <= net_amount
    AND (buy_cost_net IS NULL OR buy_cost_net >= 0)
  ),
  ADD CONSTRAINT ck_orders__gross CHECK (gross_amount = net_amount - discount_amount + vat_amount),
  ADD CONSTRAINT ck_orders__cash CHECK (cash_amount = gross_amount - wht_amount),
  ADD CONSTRAINT ck_orders__tolerance CHECK (
    (tolerance_shortage_pct IS NULL OR tolerance_shortage_pct BETWEEN 0 AND 100)
    AND (tolerance_overage_pct IS NULL OR tolerance_overage_pct BETWEEN 0 AND 100)
  ),
  ADD CONSTRAINT ck_orders__sha CHECK (octet_length(snapshot_sha256) = 32),
  ADD CONSTRAINT ck_orders__pricing_revision CHECK (pricing_revision > 0),
  ADD CONSTRAINT ck_orders__cancelled CHECK (
    (status = 'cancelled') = (cancelled_at IS NOT NULL) AND (status <> 'cancelled' OR cancel_reason_id IS NOT NULL)
  ),
  ADD CONSTRAINT ck_orders__completed CHECK (status <> 'completed' OR completed_at IS NOT NULL),
  ADD CONSTRAINT ck_orders__started CHECK (
    status NOT IN ('in_production', 'shipping', 'completed')
    OR (production_started_at IS NOT NULL AND start_mode IS NOT NULL)
  );

-- The snapshot (identity, quote, configuration) is write-once. Pricing columns change only through a
-- re-price before production, which bumps `pricing_revision` (the previous one is kept in
-- `order_price_revisions`). Orders are never deleted.
CREATE FUNCTION tg_orders__snapshot_write_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'orders are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.order_code <> OLD.order_code OR NEW.entity_id <> OLD.entity_id
     OR NEW.order_group_id <> OLD.order_group_id OR NEW.product_type_id <> OLD.product_type_id
     OR NEW.catalog_product_id IS DISTINCT FROM OLD.catalog_product_id
     OR NEW.stock_product_id IS DISTINCT FROM OLD.stock_product_id
     OR NEW.reorder_of_order_id IS DISTINCT FROM OLD.reorder_of_order_id
     OR NEW.unit <> OLD.unit OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'order % identity is write-once', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.quote_id <> OLD.quote_id OR NEW.quote_option_id <> OLD.quote_option_id
     OR NEW.quantity_ordered <> OLD.quantity_ordered
     OR NEW.tolerance_shortage_pct IS DISTINCT FROM OLD.tolerance_shortage_pct
     OR NEW.tolerance_overage_pct IS DISTINCT FROM OLD.tolerance_overage_pct
     OR NEW.tax_nature <> OLD.tax_nature
     OR NEW.pricing_snapshot <> OLD.pricing_snapshot OR NEW.config_refs <> OLD.config_refs
     OR NEW.snapshot_sha256 <> OLD.snapshot_sha256
     OR NEW.net_amount <> OLD.net_amount OR NEW.discount_amount <> OLD.discount_amount
     OR NEW.shipping_net_amount <> OLD.shipping_net_amount OR NEW.vat_amount <> OLD.vat_amount
     OR NEW.gross_amount <> OLD.gross_amount OR NEW.wht_amount <> OLD.wht_amount
     OR NEW.cash_amount <> OLD.cash_amount
     OR NEW.buy_cost_net IS DISTINCT FROM OLD.buy_cost_net
     OR NEW.margin_amount IS DISTINCT FROM OLD.margin_amount
     OR NEW.margin_pct IS DISTINCT FROM OLD.margin_pct
     OR NEW.selected_factory_id IS DISTINCT FROM OLD.selected_factory_id
     OR NEW.below_margin_floor <> OLD.below_margin_floor
     OR NEW.pricing_revision <> OLD.pricing_revision THEN
    IF OLD.status NOT IN ('waiting_payment', 'paid_for_production', 'artwork_approved')
       OR NEW.pricing_revision <> OLD.pricing_revision + 1 THEN
      RAISE EXCEPTION 'order % pricing changes only by a re-price before production', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_orders__snapshot_write_once BEFORE UPDATE OR DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION tg_orders__snapshot_write_once();

-- Lines, discounts and destinations are written at checkout and by a re-price or edit before
-- production; once production started (or the order is cancelled) they are frozen.
CREATE FUNCTION forbid_order_child_change_after_production() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_status order_status;
BEGIN
  SELECT status INTO current_status FROM orders
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  IF current_status NOT IN ('waiting_payment', 'paid_for_production', 'artwork_approved') THEN
    RAISE EXCEPTION '% of a % order cannot be changed', TG_TABLE_NAME, current_status
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

ALTER TABLE order_lines
  ADD CONSTRAINT ck_order_lines__line_no CHECK (line_no > 0),
  ADD CONSTRAINT ck_order_lines__quantity CHECK (quantity > 0),
  ADD CONSTRAINT ck_order_lines__amounts CHECK (
    unit_price >= 0 AND net_amount >= 0 AND discount_amount >= 0 AND vat_amount >= 0
    AND wht_amount >= 0 AND vat_rate_pct BETWEEN 0 AND 100 AND wht_rate_pct BETWEEN 0 AND 100
    AND discount_amount <= net_amount AND (buy_cost_net IS NULL OR buy_cost_net >= 0)
  ),
  ADD CONSTRAINT ck_order_lines__gross CHECK (gross_amount = net_amount - discount_amount + vat_amount),
  ADD CONSTRAINT ck_order_lines__wht CHECK (wht_category <> 'none' OR (wht_rate_pct = 0 AND wht_amount = 0));
CREATE TRIGGER tg_order_lines__before_production BEFORE INSERT OR UPDATE OR DELETE ON order_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_order_child_change_after_production();

ALTER TABLE order_discounts
  ADD CONSTRAINT ck_order_discounts__amounts CHECK (
    amount >= 0 AND capped_amount >= 0 AND (pct IS NULL OR pct BETWEEN 0 AND 100)
  ),
  ADD CONSTRAINT ck_order_discounts__cap CHECK (capped_amount = 0 OR cap_reason IS NOT NULL);
CREATE TRIGGER tg_order_discounts__before_production BEFORE INSERT OR UPDATE OR DELETE ON order_discounts
  FOR EACH ROW EXECUTE FUNCTION forbid_order_child_change_after_production();

ALTER TABLE order_destinations
  ADD CONSTRAINT ck_order_destinations__quantity CHECK (quantity > 0),
  ADD CONSTRAINT ck_order_destinations__postcode CHECK (postcode ~ '^[0-9]{5}$'),
  ADD CONSTRAINT ck_order_destinations__phone_e164 CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT ck_order_destinations__shipping CHECK (shipping_net_amount >= 0);
CREATE TRIGGER tg_order_destinations__before_production BEFORE INSERT OR UPDATE OR DELETE ON order_destinations
  FOR EACH ROW EXECUTE FUNCTION forbid_order_child_change_after_production();

ALTER TABLE order_notes
  ADD CONSTRAINT ck_order_notes__body CHECK (btrim(body) <> '');
CREATE TRIGGER tg_order_notes__append_only BEFORE UPDATE OR DELETE ON order_notes
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_row_change();

ALTER TABLE order_price_revisions
  ADD CONSTRAINT ck_order_price_revisions__revision CHECK (revision > 0),
  ADD CONSTRAINT ck_order_price_revisions__reason CHECK (btrim(reason) <> '');
CREATE TRIGGER tg_order_price_revisions__append_only BEFORE UPDATE OR DELETE ON order_price_revisions
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_row_change();

ALTER TABLE order_cancel_reasons
  ADD CONSTRAINT ck_order_cancel_reasons__code CHECK (code ~ '^[a-z][a-z0-9_]*$');
