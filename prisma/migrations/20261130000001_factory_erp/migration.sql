-- E1 Packio Factory ERP (docs/prompts/E1-factory-erp.md; D-316 – D-327): settings, numbering, trading
-- partners, warehouses, items, stock balances and the append-only stock ledger, purchase orders and goods receipts.
-- CreateEnum
CREATE TYPE "erp_partner_kind" AS ENUM ('supplier', 'customer', 'both');

-- CreateEnum
CREATE TYPE "erp_record_status" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "erp_item_kind" AS ENUM ('raw_material', 'consumable', 'spare_part', 'semi_finished', 'finished_good', 'packing');

-- CreateEnum
CREATE TYPE "erp_unit" AS ENUM ('kg', 'g', 'ton', 'sheet', 'ream', 'roll', 'm', 'm2', 'pcs', 'box', 'pack', 'set', 'l', 'ml');

-- CreateEnum
CREATE TYPE "erp_movement_kind" AS ENUM ('opening', 'receipt', 'issue', 'return', 'adjustment', 'count', 'transfer_out', 'transfer_in');

-- CreateEnum
CREATE TYPE "erp_vat_mode" AS ENUM ('exclusive', 'inclusive', 'none');

-- CreateEnum
CREATE TYPE "erp_purchase_order_status" AS ENUM ('draft', 'issued', 'partially_received', 'received', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "erp_document_type" AS ENUM ('po', 'gr', 'adj', 'trf', 'iss');

-- CreateTable
CREATE TABLE "erp_factory_settings" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "factory_id" BIGINT NOT NULL,
    "disabled_modules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allow_negative_stock" BOOLEAN NOT NULL DEFAULT false,
    "over_receipt_pct" DECIMAL(7,4) NOT NULL DEFAULT 10,
    "prefixes" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_factory_settings" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_document_series" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "factory_id" BIGINT NOT NULL,
    "doc_type" "erp_document_type" NOT NULL,
    "period" CHAR(4) NOT NULL,
    "next_no" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_document_series" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_trading_partners" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "erp_partner_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "tax_id" CHAR(13),
    "branch_code" CHAR(5),
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "payment_term_days" INTEGER NOT NULL DEFAULT 0,
    "credit_limit" DECIMAL(14,2),
    "note" TEXT,
    "status" "erp_record_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_trading_partners" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_warehouses" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" "erp_record_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_warehouses" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_items" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "erp_item_kind" NOT NULL,
    "material_id" BIGINT,
    "base_unit" "erp_unit" NOT NULL,
    "purchase_unit" "erp_unit",
    "purchase_factor" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "reorder_point" DECIMAL(14,3),
    "reorder_qty" DECIMAL(14,3),
    "lead_time_days" INTEGER,
    "default_supplier_id" BIGINT,
    "track_lots" BOOLEAN NOT NULL DEFAULT false,
    "last_purchase_price" DECIMAL(18,6),
    "note" TEXT,
    "status" "erp_record_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_items" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_stock_balances" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "factory_id" BIGINT NOT NULL,
    "item_id" BIGINT NOT NULL,
    "warehouse_id" BIGINT NOT NULL,
    "on_hand" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "avg_cost" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_erp_stock_balances" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_stock_movements" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "item_id" BIGINT NOT NULL,
    "warehouse_id" BIGINT NOT NULL,
    "kind" "erp_movement_kind" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_cost" DECIMAL(18,6) NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "balance_after" DECIMAL(14,3) NOT NULL,
    "avg_cost_after" DECIMAL(18,6) NOT NULL,
    "lot_no" TEXT,
    "source_type" TEXT NOT NULL,
    "source_public_id" UUID NOT NULL,
    "document_no" TEXT NOT NULL,
    "reason" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,

    CONSTRAINT "pk_erp_stock_movements" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_purchase_orders" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "po_no" TEXT,
    "supplier_id" BIGINT NOT NULL,
    "status" "erp_purchase_order_status" NOT NULL DEFAULT 'draft',
    "ordered_on" DATE NOT NULL,
    "expected_on" DATE,
    "vat_mode" "erp_vat_mode" NOT NULL DEFAULT 'exclusive',
    "vat_rate_pct" DECIMAL(7,4) NOT NULL DEFAULT 7,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "supplier_ref" TEXT,
    "deliver_to" TEXT,
    "note" TEXT,
    "issued_at" TIMESTAMPTZ(6),
    "issued_by" BIGINT,
    "closed_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_purchase_orders" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_purchase_order_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "purchase_order_id" BIGINT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" BIGINT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" "erp_unit" NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,
    "unit_price" DECIMAL(18,6) NOT NULL,
    "discount_pct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL,
    "received_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "pk_erp_purchase_order_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_goods_receipts" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "gr_no" TEXT NOT NULL,
    "purchase_order_id" BIGINT,
    "supplier_id" BIGINT NOT NULL,
    "warehouse_id" BIGINT NOT NULL,
    "received_on" DATE NOT NULL,
    "delivery_note_no" TEXT,
    "note" TEXT,
    "total" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,

    CONSTRAINT "pk_erp_goods_receipts" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_goods_receipt_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "goods_receipt_id" BIGINT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "purchase_order_line_id" BIGINT,
    "item_id" BIGINT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" "erp_unit" NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,
    "base_quantity" DECIMAL(14,3) NOT NULL,
    "unit_cost" DECIMAL(18,6) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "lot_no" TEXT,

    CONSTRAINT "pk_erp_goods_receipt_lines" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_factory_settings__factory_id" ON "erp_factory_settings"("factory_id");

-- CreateIndex
CREATE INDEX "ix_erp_factory_settings__updated_by" ON "erp_factory_settings"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_document_series__factory_id__doc_type__period" ON "erp_document_series"("factory_id", "doc_type", "period");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_trading_partners__public_id" ON "erp_trading_partners"("public_id");

-- CreateIndex
CREATE INDEX "ix_erp_trading_partners__factory_id__kind__status" ON "erp_trading_partners"("factory_id", "kind", "status");

-- CreateIndex
CREATE INDEX "ix_erp_trading_partners__created_by" ON "erp_trading_partners"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_trading_partners__updated_by" ON "erp_trading_partners"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_trading_partners__factory_id__code" ON "erp_trading_partners"("factory_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_warehouses__public_id" ON "erp_warehouses"("public_id");

-- CreateIndex
CREATE INDEX "ix_erp_warehouses__created_by" ON "erp_warehouses"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_warehouses__updated_by" ON "erp_warehouses"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_warehouses__factory_id__code" ON "erp_warehouses"("factory_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_items__public_id" ON "erp_items"("public_id");

-- CreateIndex
CREATE INDEX "ix_erp_items__factory_id__kind__status" ON "erp_items"("factory_id", "kind", "status");

-- CreateIndex
CREATE INDEX "ix_erp_items__material_id" ON "erp_items"("material_id");

-- CreateIndex
CREATE INDEX "ix_erp_items__default_supplier_id" ON "erp_items"("default_supplier_id");

-- CreateIndex
CREATE INDEX "ix_erp_items__created_by" ON "erp_items"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_items__updated_by" ON "erp_items"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_items__factory_id__sku" ON "erp_items"("factory_id", "sku");

-- CreateIndex
CREATE INDEX "ix_erp_stock_balances__factory_id" ON "erp_stock_balances"("factory_id");

-- CreateIndex
CREATE INDEX "ix_erp_stock_balances__warehouse_id" ON "erp_stock_balances"("warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_stock_balances__item_id__warehouse_id" ON "erp_stock_balances"("item_id", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_stock_movements__public_id" ON "erp_stock_movements"("public_id");

-- CreateIndex
CREATE INDEX "ix_erp_stock_movements__factory_id__occurred_at" ON "erp_stock_movements"("factory_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "ix_erp_stock_movements__item_id__occurred_at" ON "erp_stock_movements"("item_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "ix_erp_stock_movements__warehouse_id" ON "erp_stock_movements"("warehouse_id");

-- CreateIndex
CREATE INDEX "ix_erp_stock_movements__source_public_id" ON "erp_stock_movements"("source_public_id");

-- CreateIndex
CREATE INDEX "ix_erp_stock_movements__created_by" ON "erp_stock_movements"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_purchase_orders__public_id" ON "erp_purchase_orders"("public_id");

-- CreateIndex
CREATE INDEX "ix_erp_purchase_orders__factory_id__status" ON "erp_purchase_orders"("factory_id", "status");

-- CreateIndex
CREATE INDEX "ix_erp_purchase_orders__supplier_id" ON "erp_purchase_orders"("supplier_id");

-- CreateIndex
CREATE INDEX "ix_erp_purchase_orders__issued_by" ON "erp_purchase_orders"("issued_by");

-- CreateIndex
CREATE INDEX "ix_erp_purchase_orders__created_by" ON "erp_purchase_orders"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_purchase_orders__updated_by" ON "erp_purchase_orders"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_purchase_orders__factory_id__po_no" ON "erp_purchase_orders"("factory_id", "po_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_purchase_order_lines__public_id" ON "erp_purchase_order_lines"("public_id");

-- CreateIndex
CREATE INDEX "ix_erp_purchase_order_lines__item_id" ON "erp_purchase_order_lines"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_purchase_order_lines__purchase_order_id__line_no" ON "erp_purchase_order_lines"("purchase_order_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_goods_receipts__public_id" ON "erp_goods_receipts"("public_id");

-- CreateIndex
CREATE INDEX "ix_erp_goods_receipts__factory_id__received_on" ON "erp_goods_receipts"("factory_id", "received_on" DESC);

-- CreateIndex
CREATE INDEX "ix_erp_goods_receipts__purchase_order_id" ON "erp_goods_receipts"("purchase_order_id");

-- CreateIndex
CREATE INDEX "ix_erp_goods_receipts__supplier_id" ON "erp_goods_receipts"("supplier_id");

-- CreateIndex
CREATE INDEX "ix_erp_goods_receipts__warehouse_id" ON "erp_goods_receipts"("warehouse_id");

-- CreateIndex
CREATE INDEX "ix_erp_goods_receipts__created_by" ON "erp_goods_receipts"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_goods_receipts__factory_id__gr_no" ON "erp_goods_receipts"("factory_id", "gr_no");

-- CreateIndex
CREATE INDEX "ix_erp_goods_receipt_lines__purchase_order_line_id" ON "erp_goods_receipt_lines"("purchase_order_line_id");

-- CreateIndex
CREATE INDEX "ix_erp_goods_receipt_lines__item_id" ON "erp_goods_receipt_lines"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_goods_receipt_lines__goods_receipt_id__line_no" ON "erp_goods_receipt_lines"("goods_receipt_id", "line_no");

-- AddForeignKey
ALTER TABLE "erp_factory_settings" ADD CONSTRAINT "fk_erp_factory_settings__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_factory_settings" ADD CONSTRAINT "fk_erp_factory_settings__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_document_series" ADD CONSTRAINT "fk_erp_document_series__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_trading_partners" ADD CONSTRAINT "fk_erp_trading_partners__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_trading_partners" ADD CONSTRAINT "fk_erp_trading_partners__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_trading_partners" ADD CONSTRAINT "fk_erp_trading_partners__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_warehouses" ADD CONSTRAINT "fk_erp_warehouses__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_warehouses" ADD CONSTRAINT "fk_erp_warehouses__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_warehouses" ADD CONSTRAINT "fk_erp_warehouses__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_items" ADD CONSTRAINT "fk_erp_items__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_items" ADD CONSTRAINT "fk_erp_items__material_id" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_items" ADD CONSTRAINT "fk_erp_items__default_supplier_id" FOREIGN KEY ("default_supplier_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_items" ADD CONSTRAINT "fk_erp_items__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_items" ADD CONSTRAINT "fk_erp_items__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_stock_balances" ADD CONSTRAINT "fk_erp_stock_balances__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_stock_balances" ADD CONSTRAINT "fk_erp_stock_balances__item_id" FOREIGN KEY ("item_id") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_stock_balances" ADD CONSTRAINT "fk_erp_stock_balances__warehouse_id" FOREIGN KEY ("warehouse_id") REFERENCES "erp_warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_stock_movements" ADD CONSTRAINT "fk_erp_stock_movements__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_stock_movements" ADD CONSTRAINT "fk_erp_stock_movements__item_id" FOREIGN KEY ("item_id") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_stock_movements" ADD CONSTRAINT "fk_erp_stock_movements__warehouse_id" FOREIGN KEY ("warehouse_id") REFERENCES "erp_warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_stock_movements" ADD CONSTRAINT "fk_erp_stock_movements__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_purchase_orders" ADD CONSTRAINT "fk_erp_purchase_orders__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_purchase_orders" ADD CONSTRAINT "fk_erp_purchase_orders__supplier_id" FOREIGN KEY ("supplier_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_purchase_orders" ADD CONSTRAINT "fk_erp_purchase_orders__issued_by" FOREIGN KEY ("issued_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_purchase_orders" ADD CONSTRAINT "fk_erp_purchase_orders__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_purchase_orders" ADD CONSTRAINT "fk_erp_purchase_orders__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_purchase_order_lines" ADD CONSTRAINT "fk_erp_purchase_order_lines__purchase_order_id" FOREIGN KEY ("purchase_order_id") REFERENCES "erp_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_purchase_order_lines" ADD CONSTRAINT "fk_erp_purchase_order_lines__item_id" FOREIGN KEY ("item_id") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_goods_receipts" ADD CONSTRAINT "fk_erp_goods_receipts__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_goods_receipts" ADD CONSTRAINT "fk_erp_goods_receipts__purchase_order_id" FOREIGN KEY ("purchase_order_id") REFERENCES "erp_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_goods_receipts" ADD CONSTRAINT "fk_erp_goods_receipts__supplier_id" FOREIGN KEY ("supplier_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_goods_receipts" ADD CONSTRAINT "fk_erp_goods_receipts__warehouse_id" FOREIGN KEY ("warehouse_id") REFERENCES "erp_warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_goods_receipts" ADD CONSTRAINT "fk_erp_goods_receipts__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_goods_receipt_lines" ADD CONSTRAINT "fk_erp_goods_receipt_lines__goods_receipt_id" FOREIGN KEY ("goods_receipt_id") REFERENCES "erp_goods_receipts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_goods_receipt_lines" ADD CONSTRAINT "fk_erp_goods_receipt_lines__purchase_order_line_id" FOREIGN KEY ("purchase_order_line_id") REFERENCES "erp_purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_goods_receipt_lines" ADD CONSTRAINT "fk_erp_goods_receipt_lines__item_id" FOREIGN KEY ("item_id") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written checks and triggers (D-320 – D-325).
ALTER TABLE erp_factory_settings
  ADD CONSTRAINT ck_erp_factory_settings__over_receipt_pct CHECK (over_receipt_pct >= 0 AND over_receipt_pct <= 100),
  ADD CONSTRAINT ck_erp_factory_settings__prefixes CHECK (jsonb_typeof(prefixes) = 'object');
ALTER TABLE erp_document_series
  ADD CONSTRAINT ck_erp_document_series__period CHECK (period ~ '^[0-9]{2}(0[1-9]|1[0-2])$'),
  ADD CONSTRAINT ck_erp_document_series__next_no CHECK (next_no >= 1);
ALTER TABLE erp_trading_partners
  ADD CONSTRAINT ck_erp_trading_partners__tax_id CHECK (tax_id IS NULL OR tax_id ~ '^[0-9]{13}$'),
  ADD CONSTRAINT ck_erp_trading_partners__branch_code CHECK (branch_code IS NULL OR branch_code ~ '^[0-9]{5}$'),
  ADD CONSTRAINT ck_erp_trading_partners__payment_term_days CHECK (payment_term_days >= 0),
  ADD CONSTRAINT ck_erp_trading_partners__credit_limit CHECK (credit_limit IS NULL OR credit_limit >= 0);
-- One default warehouse per factory.
CREATE UNIQUE INDEX ux_erp_warehouses__factory_id__default ON erp_warehouses (factory_id) WHERE is_default;
ALTER TABLE erp_items
  ADD CONSTRAINT ck_erp_items__purchase_factor CHECK (purchase_factor > 0),
  ADD CONSTRAINT ck_erp_items__reorder CHECK ((reorder_point IS NULL OR reorder_point >= 0) AND (reorder_qty IS NULL OR reorder_qty > 0)),
  ADD CONSTRAINT ck_erp_items__lead_time_days CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  ADD CONSTRAINT ck_erp_items__last_purchase_price CHECK (last_purchase_price IS NULL OR last_purchase_price >= 0);
ALTER TABLE erp_stock_balances
  ADD CONSTRAINT ck_erp_stock_balances__reserved CHECK (reserved >= 0),
  ADD CONSTRAINT ck_erp_stock_balances__avg_cost CHECK (avg_cost >= 0);
ALTER TABLE erp_stock_movements
  ADD CONSTRAINT ck_erp_stock_movements__quantity CHECK (quantity <> 0),
  ADD CONSTRAINT ck_erp_stock_movements__unit_cost CHECK (unit_cost >= 0),
  ADD CONSTRAINT ck_erp_stock_movements__sign CHECK (
    (kind IN ('receipt', 'return', 'transfer_in', 'opening') AND quantity > 0)
    OR (kind IN ('issue', 'transfer_out') AND quantity < 0)
    OR kind IN ('adjustment', 'count'));
CREATE TRIGGER tg_erp_stock_movements__append_only BEFORE UPDATE OR DELETE ON erp_stock_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
ALTER TABLE erp_purchase_orders
  ADD CONSTRAINT ck_erp_purchase_orders__po_no CHECK ((status = 'draft') = (po_no IS NULL) OR status = 'cancelled'),
  ADD CONSTRAINT ck_erp_purchase_orders__amounts CHECK (subtotal >= 0 AND vat_amount >= 0 AND total >= 0),
  ADD CONSTRAINT ck_erp_purchase_orders__vat_rate_pct CHECK (vat_rate_pct >= 0 AND vat_rate_pct < 100),
  ADD CONSTRAINT ck_erp_purchase_orders__expected_on CHECK (expected_on IS NULL OR expected_on >= ordered_on);
ALTER TABLE erp_purchase_order_lines
  ADD CONSTRAINT ck_erp_purchase_order_lines__quantity CHECK (quantity > 0 AND received_qty >= 0),
  ADD CONSTRAINT ck_erp_purchase_order_lines__price CHECK (unit_price >= 0 AND factor > 0 AND amount >= 0),
  ADD CONSTRAINT ck_erp_purchase_order_lines__discount_pct CHECK (discount_pct >= 0 AND discount_pct <= 100);
ALTER TABLE erp_goods_receipt_lines
  ADD CONSTRAINT ck_erp_goods_receipt_lines__quantity CHECK (quantity > 0 AND base_quantity > 0 AND factor > 0),
  ADD CONSTRAINT ck_erp_goods_receipt_lines__cost CHECK (unit_cost >= 0 AND amount >= 0);
-- A posted goods receipt is final (D-325).
CREATE TRIGGER tg_erp_goods_receipts__append_only BEFORE UPDATE OR DELETE ON erp_goods_receipts
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER tg_erp_goods_receipt_lines__append_only BEFORE UPDATE OR DELETE ON erp_goods_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
