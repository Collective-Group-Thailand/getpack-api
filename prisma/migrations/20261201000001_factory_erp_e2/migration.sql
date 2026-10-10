-- E1.1 + E2 Packio Factory ERP (docs/prompts/E1-factory-erp.md; D-333 – D-345): supplier price lists and price
-- history, purchase requests, supplier invoices with 3-way match, supplier payments, recipes, production orders
-- with material reservations, and MRP.

-- AlterEnum
ALTER TYPE "erp_document_type" ADD VALUE 'pr';
ALTER TYPE "erp_document_type" ADD VALUE 'ap';
ALTER TYPE "erp_document_type" ADD VALUE 'pv';
ALTER TYPE "erp_document_type" ADD VALUE 'mo';

-- AlterEnum
ALTER TYPE "erp_movement_kind" ADD VALUE 'production_issue';
ALTER TYPE "erp_movement_kind" ADD VALUE 'production_return';
ALTER TYPE "erp_movement_kind" ADD VALUE 'production_receipt';

-- CreateEnum
CREATE TYPE "erp_price_source" AS ENUM ('goods_receipt', 'purchase_order', 'quotation', 'manual');

-- CreateEnum
CREATE TYPE "erp_purchase_request_status" AS ENUM ('draft', 'submitted', 'approved', 'rejected', 'ordered', 'cancelled');

-- CreateEnum
CREATE TYPE "erp_request_source" AS ENUM ('manual', 'reorder', 'mrp');

-- CreateEnum
CREATE TYPE "erp_supplier_invoice_status" AS ENUM ('matched', 'variance', 'approved', 'partially_paid', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "erp_payment_method" AS ENUM ('transfer', 'cash', 'cheque', 'other');

-- CreateEnum
CREATE TYPE "erp_production_source" AS ENUM ('packio_job', 'stock', 'sales_order');

-- CreateEnum
CREATE TYPE "erp_production_status" AS ENUM ('planned', 'released', 'in_progress', 'completed', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "erp_operation_status" AS ENUM ('pending', 'in_progress', 'done', 'skipped');

-- AlterTable
ALTER TABLE "erp_factory_settings" ADD COLUMN "price_tolerance_pct" DECIMAL(7,4) NOT NULL DEFAULT 2,
ADD COLUMN "require_request_approval" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "erp_item_suppliers" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "item_id" BIGINT NOT NULL,
    "supplier_id" BIGINT NOT NULL,
    "supplier_sku" TEXT,
    "supplier_name" TEXT,
    "purchase_unit" "erp_unit" NOT NULL,
    "purchase_factor" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "min_order_qty" DECIMAL(14,3),
    "lead_time_days" INTEGER,
    "last_price" DECIMAL(18,6),
    "last_priced_on" DATE,
    "last_purchased_on" DATE,
    "preferred" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "status" "erp_record_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_item_suppliers" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_price_records" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "item_id" BIGINT NOT NULL,
    "supplier_id" BIGINT NOT NULL,
    "source" "erp_price_source" NOT NULL,
    "unit" "erp_unit" NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,
    "unit_price" DECIMAL(18,6) NOT NULL,
    "base_unit_price" DECIMAL(18,6) NOT NULL,
    "quantity" DECIMAL(14,3),
    "priced_on" DATE NOT NULL,
    "valid_until" DATE,
    "source_public_id" UUID,
    "document_no" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,

    CONSTRAINT "pk_erp_price_records" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_purchase_requests" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "pr_no" TEXT NOT NULL,
    "status" "erp_purchase_request_status" NOT NULL DEFAULT 'draft',
    "source" "erp_request_source" NOT NULL DEFAULT 'manual',
    "needed_by" DATE,
    "note" TEXT,
    "estimated_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMPTZ(6),
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" BIGINT,
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_purchase_requests" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_purchase_request_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "purchase_request_id" BIGINT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" BIGINT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "supplier_id" BIGINT,
    "estimated_unit_cost" DECIMAL(18,6),
    "needed_by" DATE,
    "note" TEXT,
    "purchase_order_line_id" BIGINT,

    CONSTRAINT "pk_erp_purchase_request_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_supplier_invoices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "doc_no" TEXT NOT NULL,
    "supplier_id" BIGINT NOT NULL,
    "purchase_order_id" BIGINT,
    "invoice_no" TEXT NOT NULL,
    "tax_invoice_no" TEXT,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "vat_mode" "erp_vat_mode" NOT NULL DEFAULT 'exclusive',
    "vat_rate_pct" DECIMAL(7,4) NOT NULL DEFAULT 7,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "wht_rate_pct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "wht_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payable_amount" DECIMAL(14,2) NOT NULL,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "erp_supplier_invoice_status" NOT NULL,
    "match_note" TEXT,
    "note" TEXT,
    "file_id" BIGINT,
    "approved_at" TIMESTAMPTZ(6),
    "approved_by" BIGINT,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_supplier_invoices" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_supplier_invoice_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "supplier_invoice_id" BIGINT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "purchase_order_line_id" BIGINT,
    "item_id" BIGINT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_price" DECIMAL(18,6) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "received_qty" DECIMAL(14,3),
    "ordered_price" DECIMAL(18,6),
    "variance" TEXT,

    CONSTRAINT "pk_erp_supplier_invoice_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_supplier_payments" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "payment_no" TEXT NOT NULL,
    "supplier_id" BIGINT NOT NULL,
    "paid_on" DATE NOT NULL,
    "method" "erp_payment_method" NOT NULL,
    "reference" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "reverses_id" BIGINT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,

    CONSTRAINT "pk_erp_supplier_payments" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_payment_allocations" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "payment_id" BIGINT NOT NULL,
    "supplier_invoice_id" BIGINT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "pk_erp_payment_allocations" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_recipes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "item_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "batch_qty" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "note" TEXT,
    "status" "erp_record_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_recipes" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_recipe_materials" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "recipe_id" BIGINT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" BIGINT NOT NULL,
    "quantity" DECIMAL(14,6) NOT NULL,
    "scrap_pct" DECIMAL(7,4) NOT NULL DEFAULT 0,

    CONSTRAINT "pk_erp_recipe_materials" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_recipe_operations" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "recipe_id" BIGINT NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "machine_id" BIGINT,
    "setup_minutes" INTEGER NOT NULL DEFAULT 0,
    "run_rate_per_hour" DECIMAL(14,3),

    CONSTRAINT "pk_erp_recipe_operations" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_production_orders" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "mo_no" TEXT NOT NULL,
    "source" "erp_production_source" NOT NULL,
    "production_job_id" BIGINT,
    "item_id" BIGINT,
    "recipe_id" BIGINT,
    "title" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "due_on" DATE,
    "planned_start_on" DATE,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "warehouse_id" BIGINT NOT NULL,
    "status" "erp_production_status" NOT NULL DEFAULT 'planned',
    "good_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "scrap_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "note" TEXT,
    "released_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_production_orders" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_production_materials" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "production_order_id" BIGINT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" BIGINT NOT NULL,
    "required_qty" DECIMAL(14,3) NOT NULL,
    "reserved_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "issued_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "origin" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "pk_erp_production_materials" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_production_operations" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "production_order_id" BIGINT NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "machine_id" BIGINT,
    "planned_minutes" INTEGER NOT NULL DEFAULT 0,
    "status" "erp_operation_status" NOT NULL DEFAULT 'pending',
    "good_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "scrap_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "pk_erp_production_operations" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_item_suppliers__public_id" ON "erp_item_suppliers"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_item_suppliers__item_id__supplier_id" ON "erp_item_suppliers"("item_id", "supplier_id");

-- CreateIndex
CREATE INDEX "ix_erp_item_suppliers__factory_id" ON "erp_item_suppliers"("factory_id");

-- CreateIndex
CREATE INDEX "ix_erp_item_suppliers__supplier_id" ON "erp_item_suppliers"("supplier_id");

-- CreateIndex
CREATE INDEX "ix_erp_item_suppliers__created_by" ON "erp_item_suppliers"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_item_suppliers__updated_by" ON "erp_item_suppliers"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_price_records__public_id" ON "erp_price_records"("public_id");

-- CreateIndex
CREATE INDEX "ix_erp_price_records__item_id__priced_on" ON "erp_price_records"("item_id", "priced_on" DESC);

-- CreateIndex
CREATE INDEX "ix_erp_price_records__supplier_id__priced_on" ON "erp_price_records"("supplier_id", "priced_on" DESC);

-- CreateIndex
CREATE INDEX "ix_erp_price_records__factory_id" ON "erp_price_records"("factory_id");

-- CreateIndex
CREATE INDEX "ix_erp_price_records__created_by" ON "erp_price_records"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_purchase_requests__public_id" ON "erp_purchase_requests"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_purchase_requests__factory_id__pr_no" ON "erp_purchase_requests"("factory_id", "pr_no");

-- CreateIndex
CREATE INDEX "ix_erp_purchase_requests__factory_id__status" ON "erp_purchase_requests"("factory_id", "status");

-- CreateIndex
CREATE INDEX "ix_erp_purchase_requests__decided_by" ON "erp_purchase_requests"("decided_by");

-- CreateIndex
CREATE INDEX "ix_erp_purchase_requests__created_by" ON "erp_purchase_requests"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_purchase_requests__updated_by" ON "erp_purchase_requests"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_purchase_request_lines__public_id" ON "erp_purchase_request_lines"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_purchase_request_lines__purchase_request_id__line_no" ON "erp_purchase_request_lines"("purchase_request_id", "line_no");

-- CreateIndex
CREATE INDEX "ix_erp_purchase_request_lines__item_id" ON "erp_purchase_request_lines"("item_id");

-- CreateIndex
CREATE INDEX "ix_erp_purchase_request_lines__supplier_id" ON "erp_purchase_request_lines"("supplier_id");

-- CreateIndex
CREATE INDEX "ix_erp_purchase_request_lines__purchase_order_line_id" ON "erp_purchase_request_lines"("purchase_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_supplier_invoices__public_id" ON "erp_supplier_invoices"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_supplier_invoices__factory_id__doc_no" ON "erp_supplier_invoices"("factory_id", "doc_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_supplier_invoices__supplier_id__invoice_no" ON "erp_supplier_invoices"("supplier_id", "invoice_no");

-- CreateIndex
CREATE INDEX "ix_erp_supplier_invoices__factory_id__status__due_date" ON "erp_supplier_invoices"("factory_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "ix_erp_supplier_invoices__purchase_order_id" ON "erp_supplier_invoices"("purchase_order_id");

-- CreateIndex
CREATE INDEX "ix_erp_supplier_invoices__file_id" ON "erp_supplier_invoices"("file_id");

-- CreateIndex
CREATE INDEX "ix_erp_supplier_invoices__approved_by" ON "erp_supplier_invoices"("approved_by");

-- CreateIndex
CREATE INDEX "ix_erp_supplier_invoices__created_by" ON "erp_supplier_invoices"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_supplier_invoice_lines__supplier_invoice_id__line_no" ON "erp_supplier_invoice_lines"("supplier_invoice_id", "line_no");

-- CreateIndex
CREATE INDEX "ix_erp_supplier_invoice_lines__purchase_order_line_id" ON "erp_supplier_invoice_lines"("purchase_order_line_id");

-- CreateIndex
CREATE INDEX "ix_erp_supplier_invoice_lines__item_id" ON "erp_supplier_invoice_lines"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_supplier_payments__public_id" ON "erp_supplier_payments"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_supplier_payments__reverses_id" ON "erp_supplier_payments"("reverses_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_supplier_payments__factory_id__payment_no" ON "erp_supplier_payments"("factory_id", "payment_no");

-- CreateIndex
CREATE INDEX "ix_erp_supplier_payments__supplier_id" ON "erp_supplier_payments"("supplier_id");

-- CreateIndex
CREATE INDEX "ix_erp_supplier_payments__created_by" ON "erp_supplier_payments"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_payment_allocations__payment_id__supplier_invoice_id" ON "erp_payment_allocations"("payment_id", "supplier_invoice_id");

-- CreateIndex
CREATE INDEX "ix_erp_payment_allocations__supplier_invoice_id" ON "erp_payment_allocations"("supplier_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_recipes__public_id" ON "erp_recipes"("public_id");

-- CreateIndex
CREATE INDEX "ix_erp_recipes__factory_id__status" ON "erp_recipes"("factory_id", "status");

-- CreateIndex
CREATE INDEX "ix_erp_recipes__item_id" ON "erp_recipes"("item_id");

-- CreateIndex
CREATE INDEX "ix_erp_recipes__created_by" ON "erp_recipes"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_recipes__updated_by" ON "erp_recipes"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_recipe_materials__recipe_id__line_no" ON "erp_recipe_materials"("recipe_id", "line_no");

-- CreateIndex
CREATE INDEX "ix_erp_recipe_materials__item_id" ON "erp_recipe_materials"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_recipe_operations__recipe_id__seq" ON "erp_recipe_operations"("recipe_id", "seq");

-- CreateIndex
CREATE INDEX "ix_erp_recipe_operations__machine_id" ON "erp_recipe_operations"("machine_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_production_orders__public_id" ON "erp_production_orders"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_production_orders__factory_id__mo_no" ON "erp_production_orders"("factory_id", "mo_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_production_orders__production_job_id" ON "erp_production_orders"("production_job_id");

-- CreateIndex
CREATE INDEX "ix_erp_production_orders__factory_id__status__due_on" ON "erp_production_orders"("factory_id", "status", "due_on");

-- CreateIndex
CREATE INDEX "ix_erp_production_orders__item_id" ON "erp_production_orders"("item_id");

-- CreateIndex
CREATE INDEX "ix_erp_production_orders__recipe_id" ON "erp_production_orders"("recipe_id");

-- CreateIndex
CREATE INDEX "ix_erp_production_orders__warehouse_id" ON "erp_production_orders"("warehouse_id");

-- CreateIndex
CREATE INDEX "ix_erp_production_orders__created_by" ON "erp_production_orders"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_production_orders__updated_by" ON "erp_production_orders"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_production_materials__public_id" ON "erp_production_materials"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_production_materials__production_order_id__line_no" ON "erp_production_materials"("production_order_id", "line_no");

-- CreateIndex
CREATE INDEX "ix_erp_production_materials__item_id" ON "erp_production_materials"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_production_operations__public_id" ON "erp_production_operations"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_production_operations__production_order_id__seq" ON "erp_production_operations"("production_order_id", "seq");

-- CreateIndex
CREATE INDEX "ix_erp_production_operations__machine_id" ON "erp_production_operations"("machine_id");

-- AddForeignKey
ALTER TABLE "erp_item_suppliers" ADD CONSTRAINT "fk_erp_item_suppliers__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_item_suppliers" ADD CONSTRAINT "fk_erp_item_suppliers__item_id" FOREIGN KEY ("item_id") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_item_suppliers" ADD CONSTRAINT "fk_erp_item_suppliers__supplier_id" FOREIGN KEY ("supplier_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_item_suppliers" ADD CONSTRAINT "fk_erp_item_suppliers__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_item_suppliers" ADD CONSTRAINT "fk_erp_item_suppliers__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_price_records" ADD CONSTRAINT "fk_erp_price_records__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_price_records" ADD CONSTRAINT "fk_erp_price_records__item_id" FOREIGN KEY ("item_id") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_price_records" ADD CONSTRAINT "fk_erp_price_records__supplier_id" FOREIGN KEY ("supplier_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_price_records" ADD CONSTRAINT "fk_erp_price_records__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_purchase_requests" ADD CONSTRAINT "fk_erp_purchase_requests__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_purchase_requests" ADD CONSTRAINT "fk_erp_purchase_requests__decided_by" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_purchase_requests" ADD CONSTRAINT "fk_erp_purchase_requests__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_purchase_requests" ADD CONSTRAINT "fk_erp_purchase_requests__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_purchase_request_lines" ADD CONSTRAINT "fk_erp_purchase_request_lines__purchase_request_id" FOREIGN KEY ("purchase_request_id") REFERENCES "erp_purchase_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_purchase_request_lines" ADD CONSTRAINT "fk_erp_purchase_request_lines__item_id" FOREIGN KEY ("item_id") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_purchase_request_lines" ADD CONSTRAINT "fk_erp_purchase_request_lines__supplier_id" FOREIGN KEY ("supplier_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_purchase_request_lines" ADD CONSTRAINT "fk_erp_purchase_request_lines__purchase_order_line_id" FOREIGN KEY ("purchase_order_line_id") REFERENCES "erp_purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_supplier_invoices" ADD CONSTRAINT "fk_erp_supplier_invoices__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_supplier_invoices" ADD CONSTRAINT "fk_erp_supplier_invoices__supplier_id" FOREIGN KEY ("supplier_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_supplier_invoices" ADD CONSTRAINT "fk_erp_supplier_invoices__purchase_order_id" FOREIGN KEY ("purchase_order_id") REFERENCES "erp_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_supplier_invoices" ADD CONSTRAINT "fk_erp_supplier_invoices__file_id" FOREIGN KEY ("file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_supplier_invoices" ADD CONSTRAINT "fk_erp_supplier_invoices__approved_by" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_supplier_invoices" ADD CONSTRAINT "fk_erp_supplier_invoices__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_supplier_invoice_lines" ADD CONSTRAINT "fk_erp_supplier_invoice_lines__supplier_invoice_id" FOREIGN KEY ("supplier_invoice_id") REFERENCES "erp_supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_supplier_invoice_lines" ADD CONSTRAINT "fk_erp_supplier_invoice_lines__purchase_order_line_id" FOREIGN KEY ("purchase_order_line_id") REFERENCES "erp_purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_supplier_invoice_lines" ADD CONSTRAINT "fk_erp_supplier_invoice_lines__item_id" FOREIGN KEY ("item_id") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_supplier_payments" ADD CONSTRAINT "fk_erp_supplier_payments__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_supplier_payments" ADD CONSTRAINT "fk_erp_supplier_payments__supplier_id" FOREIGN KEY ("supplier_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_supplier_payments" ADD CONSTRAINT "fk_erp_supplier_payments__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_supplier_payments" ADD CONSTRAINT "fk_erp_supplier_payments__reverses_id" FOREIGN KEY ("reverses_id") REFERENCES "erp_supplier_payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_payment_allocations" ADD CONSTRAINT "fk_erp_payment_allocations__payment_id" FOREIGN KEY ("payment_id") REFERENCES "erp_supplier_payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_payment_allocations" ADD CONSTRAINT "fk_erp_payment_allocations__supplier_invoice_id" FOREIGN KEY ("supplier_invoice_id") REFERENCES "erp_supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_recipes" ADD CONSTRAINT "fk_erp_recipes__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_recipes" ADD CONSTRAINT "fk_erp_recipes__item_id" FOREIGN KEY ("item_id") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_recipes" ADD CONSTRAINT "fk_erp_recipes__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_recipes" ADD CONSTRAINT "fk_erp_recipes__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_recipe_materials" ADD CONSTRAINT "fk_erp_recipe_materials__recipe_id" FOREIGN KEY ("recipe_id") REFERENCES "erp_recipes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_recipe_materials" ADD CONSTRAINT "fk_erp_recipe_materials__item_id" FOREIGN KEY ("item_id") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_recipe_operations" ADD CONSTRAINT "fk_erp_recipe_operations__recipe_id" FOREIGN KEY ("recipe_id") REFERENCES "erp_recipes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_recipe_operations" ADD CONSTRAINT "fk_erp_recipe_operations__machine_id" FOREIGN KEY ("machine_id") REFERENCES "factory_machines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_production_orders" ADD CONSTRAINT "fk_erp_production_orders__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_production_orders" ADD CONSTRAINT "fk_erp_production_orders__production_job_id" FOREIGN KEY ("production_job_id") REFERENCES "production_jobs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_production_orders" ADD CONSTRAINT "fk_erp_production_orders__item_id" FOREIGN KEY ("item_id") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_production_orders" ADD CONSTRAINT "fk_erp_production_orders__recipe_id" FOREIGN KEY ("recipe_id") REFERENCES "erp_recipes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_production_orders" ADD CONSTRAINT "fk_erp_production_orders__warehouse_id" FOREIGN KEY ("warehouse_id") REFERENCES "erp_warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_production_orders" ADD CONSTRAINT "fk_erp_production_orders__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_production_orders" ADD CONSTRAINT "fk_erp_production_orders__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_production_materials" ADD CONSTRAINT "fk_erp_production_materials__production_order_id" FOREIGN KEY ("production_order_id") REFERENCES "erp_production_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_production_materials" ADD CONSTRAINT "fk_erp_production_materials__item_id" FOREIGN KEY ("item_id") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_production_operations" ADD CONSTRAINT "fk_erp_production_operations__production_order_id" FOREIGN KEY ("production_order_id") REFERENCES "erp_production_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_production_operations" ADD CONSTRAINT "fk_erp_production_operations__machine_id" FOREIGN KEY ("machine_id") REFERENCES "factory_machines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written checks and triggers (D-333 – D-341).
-- Production movements (D-341): issues out, returns and finished goods in. Compared as text: the enum values
-- were added in this migration.
ALTER TABLE erp_stock_movements DROP CONSTRAINT ck_erp_stock_movements__sign,
  ADD CONSTRAINT ck_erp_stock_movements__sign CHECK (
    (kind::text IN ('receipt', 'return', 'transfer_in', 'opening', 'production_return', 'production_receipt') AND quantity > 0)
    OR (kind::text IN ('issue', 'transfer_out', 'production_issue') AND quantity < 0)
    OR kind::text IN ('adjustment', 'count'));
ALTER TABLE erp_factory_settings
  ADD CONSTRAINT ck_erp_factory_settings__price_tolerance_pct CHECK (price_tolerance_pct >= 0 AND price_tolerance_pct <= 100);

ALTER TABLE erp_item_suppliers
  ADD CONSTRAINT ck_erp_item_suppliers__purchase_factor CHECK (purchase_factor > 0),
  ADD CONSTRAINT ck_erp_item_suppliers__min_order_qty CHECK (min_order_qty IS NULL OR min_order_qty > 0),
  ADD CONSTRAINT ck_erp_item_suppliers__lead_time_days CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  ADD CONSTRAINT ck_erp_item_suppliers__last_price CHECK (last_price IS NULL OR last_price >= 0);
-- One preferred supplier per item (D-333).
CREATE UNIQUE INDEX ux_erp_item_suppliers__item_id__preferred ON erp_item_suppliers (item_id) WHERE preferred;

ALTER TABLE erp_price_records
  ADD CONSTRAINT ck_erp_price_records__price CHECK (unit_price >= 0 AND base_unit_price >= 0 AND factor > 0),
  ADD CONSTRAINT ck_erp_price_records__quantity CHECK (quantity IS NULL OR quantity > 0),
  ADD CONSTRAINT ck_erp_price_records__valid_until CHECK (valid_until IS NULL OR valid_until >= priced_on);
CREATE TRIGGER tg_erp_price_records__append_only BEFORE UPDATE OR DELETE ON erp_price_records
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE erp_purchase_requests
  ADD CONSTRAINT ck_erp_purchase_requests__estimated_total CHECK (estimated_total >= 0);
ALTER TABLE erp_purchase_request_lines
  ADD CONSTRAINT ck_erp_purchase_request_lines__quantity CHECK (quantity > 0),
  ADD CONSTRAINT ck_erp_purchase_request_lines__estimated_unit_cost CHECK (estimated_unit_cost IS NULL OR estimated_unit_cost >= 0);

ALTER TABLE erp_supplier_invoices
  ADD CONSTRAINT ck_erp_supplier_invoices__amounts CHECK (subtotal >= 0 AND vat_amount >= 0 AND total >= 0 AND wht_amount >= 0),
  ADD CONSTRAINT ck_erp_supplier_invoices__payable CHECK (payable_amount = total - wht_amount),
  ADD CONSTRAINT ck_erp_supplier_invoices__paid CHECK (paid_amount >= 0 AND paid_amount <= payable_amount),
  ADD CONSTRAINT ck_erp_supplier_invoices__rates CHECK (vat_rate_pct >= 0 AND vat_rate_pct < 100 AND wht_rate_pct >= 0 AND wht_rate_pct < 100),
  ADD CONSTRAINT ck_erp_supplier_invoices__due_date CHECK (due_date >= invoice_date);
ALTER TABLE erp_supplier_invoice_lines
  ADD CONSTRAINT ck_erp_supplier_invoice_lines__amounts CHECK (quantity > 0 AND unit_price >= 0 AND amount >= 0),
  ADD CONSTRAINT ck_erp_supplier_invoice_lines__variance CHECK (variance IS NULL OR variance IN ('price', 'quantity', 'price_quantity', 'unordered'));

-- A payment is never edited; a wrong one is reversed by a negative payment that names it (D-338).
ALTER TABLE erp_supplier_payments
  ADD CONSTRAINT ck_erp_supplier_payments__amount CHECK ((reverses_id IS NULL AND amount > 0) OR (reverses_id IS NOT NULL AND amount < 0));
ALTER TABLE erp_payment_allocations
  ADD CONSTRAINT ck_erp_payment_allocations__amount CHECK (amount <> 0);
CREATE TRIGGER tg_erp_supplier_payments__append_only BEFORE UPDATE OR DELETE ON erp_supplier_payments
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER tg_erp_payment_allocations__append_only BEFORE UPDATE OR DELETE ON erp_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE erp_recipes
  ADD CONSTRAINT ck_erp_recipes__batch_qty CHECK (batch_qty > 0);
ALTER TABLE erp_recipe_materials
  ADD CONSTRAINT ck_erp_recipe_materials__quantity CHECK (quantity > 0 AND scrap_pct >= 0 AND scrap_pct < 100);
ALTER TABLE erp_recipe_operations
  ADD CONSTRAINT ck_erp_recipe_operations__times CHECK (setup_minutes >= 0 AND (run_rate_per_hour IS NULL OR run_rate_per_hour > 0));

ALTER TABLE erp_production_orders
  ADD CONSTRAINT ck_erp_production_orders__quantity CHECK (quantity > 0 AND good_qty >= 0 AND scrap_qty >= 0),
  ADD CONSTRAINT ck_erp_production_orders__source CHECK ((source = 'packio_job') = (production_job_id IS NOT NULL)),
  ADD CONSTRAINT ck_erp_production_orders__item CHECK (source = 'packio_job' OR item_id IS NOT NULL),
  ADD CONSTRAINT ck_erp_production_orders__dates CHECK (due_on IS NULL OR planned_start_on IS NULL OR planned_start_on <= due_on);
ALTER TABLE erp_production_materials
  ADD CONSTRAINT ck_erp_production_materials__quantities CHECK (required_qty >= 0 AND reserved_qty >= 0 AND issued_qty >= 0),
  ADD CONSTRAINT ck_erp_production_materials__origin CHECK (origin IN ('recipe', 'packio_spec', 'manual'));
ALTER TABLE erp_production_operations
  ADD CONSTRAINT ck_erp_production_operations__quantities CHECK (planned_minutes >= 0 AND good_qty >= 0 AND scrap_qty >= 0);
