-- E2.1 + E3 Packio Factory ERP (docs/prompts/E1-factory-erp.md §10; D-346 – D-358): quantity-break prices,
-- purchasing alerts, requests for quotation, receiving inspection, landed cost, approved suppliers; the machine
-- schedule, shop-floor events, maintenance and documents.

-- AlterEnum
ALTER TYPE "erp_movement_kind" ADD VALUE 'landed_cost';
ALTER TYPE "erp_movement_kind" ADD VALUE 'maintenance_issue';

-- AlterEnum
ALTER TYPE "erp_document_type" ADD VALUE 'rfq';
ALTER TYPE "erp_document_type" ADD VALUE 'mt';

-- AlterEnum
ALTER TYPE "erp_operation_status" ADD VALUE 'paused';

-- CreateEnum
CREATE TYPE "erp_supplier_approval_policy" AS ENUM ('off', 'warn', 'enforce');

-- CreateEnum
CREATE TYPE "erp_supplier_approval" AS ENUM ('pending', 'approved', 'suspended');

-- CreateEnum
CREATE TYPE "erp_alert_kind" AS ENUM ('price_rise', 'quote_expiring', 'supplier_review_due', 'maintenance_due', 'machine_breakdown', 'document_expiring');

-- CreateEnum
CREATE TYPE "erp_alert_status" AS ENUM ('open', 'acknowledged');

-- CreateEnum
CREATE TYPE "erp_rfq_status" AS ENUM ('draft', 'sent', 'awarded', 'cancelled');

-- CreateEnum
CREATE TYPE "erp_rfq_supplier_status" AS ENUM ('invited', 'quoted', 'declined');

-- CreateEnum
CREATE TYPE "erp_charge_kind" AS ENUM ('freight', 'insurance', 'duty', 'handling', 'other');

-- CreateEnum
CREATE TYPE "erp_charge_allocation" AS ENUM ('by_value', 'by_quantity');

-- CreateEnum
CREATE TYPE "erp_operation_event_kind" AS ENUM ('start', 'pause', 'resume', 'finish', 'skip');

-- CreateEnum
CREATE TYPE "erp_pause_reason" AS ENUM ('material_shortage', 'machine_breakdown', 'setup', 'quality_issue', 'waiting_approval', 'break', 'other');

-- CreateEnum
CREATE TYPE "erp_milestone_sync" AS ENUM ('none', 'synced', 'failed');

-- CreateEnum
CREATE TYPE "erp_maintenance_kind" AS ENUM ('breakdown', 'preventive');

-- CreateEnum
CREATE TYPE "erp_maintenance_priority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "erp_maintenance_status" AS ENUM ('open', 'scheduled', 'in_progress', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "erp_doc_category" AS ENUM ('certificate', 'permit', 'contract', 'drawing', 'specification', 'manual', 'procedure', 'other');

-- CreateEnum
CREATE TYPE "erp_doc_link" AS ENUM ('trading_partner', 'item', 'machine', 'purchase_order', 'production_order', 'maintenance_order');

-- AlterTable
ALTER TABLE "erp_factory_settings" ADD COLUMN "price_alert_pct" DECIMAL(7,4) NOT NULL DEFAULT 5,
ADD COLUMN "quote_expiry_days" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN "supplier_approval" "erp_supplier_approval_policy" NOT NULL DEFAULT 'warn';

-- AlterTable
ALTER TABLE "erp_item_suppliers" ADD COLUMN "approval" "erp_supplier_approval" NOT NULL DEFAULT 'pending',
ADD COLUMN "approval_note" TEXT,
ADD COLUMN "approved_at" TIMESTAMPTZ(6),
ADD COLUMN "approved_by" BIGINT,
ADD COLUMN "review_on" DATE,
ADD COLUMN "breaks_valid_until" DATE;

-- AlterTable
ALTER TABLE "erp_goods_receipts" ADD COLUMN "charges_total" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "erp_goods_receipt_lines" ADD COLUMN "rejected_quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
ADD COLUMN "reject_reason" TEXT,
ADD COLUMN "landed_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "erp_production_operations" ADD COLUMN "scheduled_start" TIMESTAMPTZ(6),
ADD COLUMN "scheduled_end" TIMESTAMPTZ(6),
ADD COLUMN "locked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "started_at" TIMESTAMPTZ(6),
ADD COLUMN "finished_at" TIMESTAMPTZ(6),
ADD COLUMN "paused_at" TIMESTAMPTZ(6),
ADD COLUMN "paused_minutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "job_milestone_id" BIGINT,
ADD COLUMN "milestone_sync" "erp_milestone_sync" NOT NULL DEFAULT 'none',
ADD COLUMN "milestone_sync_error" TEXT;

-- DropIndex
DROP INDEX "ix_erp_production_operations__machine_id";

-- CreateIndex
CREATE INDEX "ix_erp_production_operations__machine_id__scheduled_start" ON "erp_production_operations"("machine_id", "scheduled_start");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_production_operations__job_milestone_id" ON "erp_production_operations"("job_milestone_id");

-- CreateIndex
CREATE INDEX "ix_erp_item_suppliers__approved_by" ON "erp_item_suppliers"("approved_by");

-- AddForeignKey
ALTER TABLE "erp_item_suppliers" ADD CONSTRAINT "fk_erp_item_suppliers__approved_by" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_production_operations" ADD CONSTRAINT "fk_erp_production_operations__job_milestone_id" FOREIGN KEY ("job_milestone_id") REFERENCES "job_milestones"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- CreateTable
CREATE TABLE "erp_price_breaks" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "item_supplier_id" BIGINT NOT NULL,
    "min_qty" DECIMAL(14,3) NOT NULL,
    "unit_price" DECIMAL(18,6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,

    CONSTRAINT "pk_erp_price_breaks" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_alerts" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "kind" "erp_alert_kind" NOT NULL,
    "status" "erp_alert_status" NOT NULL DEFAULT 'open',
    "dedupe_key" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_public_id" UUID NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "due_on" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ(6),
    "acknowledged_by" BIGINT,

    CONSTRAINT "pk_erp_alerts" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_rfqs" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "rfq_no" TEXT NOT NULL,
    "status" "erp_rfq_status" NOT NULL DEFAULT 'draft',
    "title" TEXT NOT NULL,
    "quote_by" DATE,
    "needed_by" DATE,
    "purchase_request_id" BIGINT,
    "note" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "awarded_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_rfqs" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_rfq_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "rfq_id" BIGINT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" BIGINT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "note" TEXT,

    CONSTRAINT "pk_erp_rfq_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_rfq_suppliers" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "rfq_id" BIGINT NOT NULL,
    "supplier_id" BIGINT NOT NULL,
    "status" "erp_rfq_supplier_status" NOT NULL DEFAULT 'invited',
    "responded_on" DATE,
    "reference" TEXT,
    "note" TEXT,
    "recorded_by" BIGINT,

    CONSTRAINT "pk_erp_rfq_suppliers" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_rfq_quotes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "rfq_supplier_id" BIGINT NOT NULL,
    "rfq_line_id" BIGINT NOT NULL,
    "unit" "erp_unit" NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,
    "unit_price" DECIMAL(18,6) NOT NULL,
    "min_order_qty" DECIMAL(14,3),
    "lead_time_days" INTEGER,
    "valid_until" DATE,
    "note" TEXT,
    "awarded" BOOLEAN NOT NULL DEFAULT false,
    "purchase_order_line_id" BIGINT,

    CONSTRAINT "pk_erp_rfq_quotes" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_landed_charges" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "goods_receipt_id" BIGINT NOT NULL,
    "kind" "erp_charge_kind" NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "allocation" "erp_charge_allocation" NOT NULL DEFAULT 'by_value',
    "partner_id" BIGINT,
    "reference" TEXT,
    "at_receipt" BOOLEAN NOT NULL,
    "absorbed" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,

    CONSTRAINT "pk_erp_landed_charges" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_landed_charge_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "charge_id" BIGINT NOT NULL,
    "goods_receipt_line_id" BIGINT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "absorbed" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "pk_erp_landed_charge_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_operation_events" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "operation_id" BIGINT NOT NULL,
    "kind" "erp_operation_event_kind" NOT NULL,
    "reason" "erp_pause_reason",
    "note" TEXT,
    "good_qty" DECIMAL(14,3),
    "scrap_qty" DECIMAL(14,3),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,

    CONSTRAINT "pk_erp_operation_events" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_maintenance_plans" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "machine_id" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "every_days" INTEGER,
    "every_impressions" INTEGER,
    "duration_minutes" INTEGER NOT NULL DEFAULT 60,
    "last_done_at" TIMESTAMPTZ(6),
    "status" "erp_record_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_maintenance_plans" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_maintenance_plan_parts" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "plan_id" BIGINT NOT NULL,
    "item_id" BIGINT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "pk_erp_maintenance_plan_parts" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_maintenance_orders" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "mt_no" TEXT NOT NULL,
    "machine_id" BIGINT NOT NULL,
    "kind" "erp_maintenance_kind" NOT NULL,
    "plan_id" BIGINT,
    "priority" "erp_maintenance_priority" NOT NULL DEFAULT 'normal',
    "status" "erp_maintenance_status" NOT NULL DEFAULT 'open',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "reported_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reported_by" BIGINT,
    "scheduled_start" TIMESTAMPTZ(6),
    "scheduled_end" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "downtime_minutes" INTEGER,
    "resolution" TEXT,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_maintenance_orders" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_maintenance_photos" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "order_id" BIGINT NOT NULL,
    "file_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,

    CONSTRAINT "pk_erp_maintenance_photos" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_maintenance_parts" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" BIGINT NOT NULL,
    "item_id" BIGINT NOT NULL,
    "warehouse_id" BIGINT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_cost" DECIMAL(18,6) NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,

    CONSTRAINT "pk_erp_maintenance_parts" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_doc_folders" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "parent_id" BIGINT,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_erp_doc_folders" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_docs" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "folder_id" BIGINT,
    "title" TEXT NOT NULL,
    "category" "erp_doc_category" NOT NULL DEFAULT 'other',
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "link_type" "erp_doc_link",
    "link_public_id" UUID,
    "link_label" TEXT,
    "expires_on" DATE,
    "remind_days" INTEGER NOT NULL DEFAULT 30,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "status" "erp_record_status" NOT NULL DEFAULT 'active',
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_docs" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_doc_versions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "doc_id" BIGINT NOT NULL,
    "version" INTEGER NOT NULL,
    "file_id" BIGINT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,

    CONSTRAINT "pk_erp_doc_versions" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_price_breaks__item_supplier_id__min_qty" ON "erp_price_breaks"("item_supplier_id", "min_qty");

-- CreateIndex
CREATE INDEX "ix_erp_price_breaks__created_by" ON "erp_price_breaks"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_alerts__public_id" ON "erp_alerts"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_alerts__factory_id__dedupe_key" ON "erp_alerts"("factory_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "ix_erp_alerts__factory_id__status__created_at" ON "erp_alerts"("factory_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_erp_alerts__acknowledged_by" ON "erp_alerts"("acknowledged_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_rfqs__public_id" ON "erp_rfqs"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_rfqs__factory_id__rfq_no" ON "erp_rfqs"("factory_id", "rfq_no");

-- CreateIndex
CREATE INDEX "ix_erp_rfqs__factory_id__status__created_at" ON "erp_rfqs"("factory_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_erp_rfqs__purchase_request_id" ON "erp_rfqs"("purchase_request_id");

-- CreateIndex
CREATE INDEX "ix_erp_rfqs__created_by" ON "erp_rfqs"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_rfqs__updated_by" ON "erp_rfqs"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_rfq_lines__public_id" ON "erp_rfq_lines"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_rfq_lines__rfq_id__line_no" ON "erp_rfq_lines"("rfq_id", "line_no");

-- CreateIndex
CREATE INDEX "ix_erp_rfq_lines__item_id" ON "erp_rfq_lines"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_rfq_suppliers__public_id" ON "erp_rfq_suppliers"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_rfq_suppliers__rfq_id__supplier_id" ON "erp_rfq_suppliers"("rfq_id", "supplier_id");

-- CreateIndex
CREATE INDEX "ix_erp_rfq_suppliers__supplier_id" ON "erp_rfq_suppliers"("supplier_id");

-- CreateIndex
CREATE INDEX "ix_erp_rfq_suppliers__recorded_by" ON "erp_rfq_suppliers"("recorded_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_rfq_quotes__public_id" ON "erp_rfq_quotes"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_rfq_quotes__purchase_order_line_id" ON "erp_rfq_quotes"("purchase_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_rfq_quotes__rfq_supplier_id__rfq_line_id" ON "erp_rfq_quotes"("rfq_supplier_id", "rfq_line_id");

-- CreateIndex
CREATE INDEX "ix_erp_rfq_quotes__rfq_line_id" ON "erp_rfq_quotes"("rfq_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_landed_charges__public_id" ON "erp_landed_charges"("public_id");

-- CreateIndex
CREATE INDEX "ix_erp_landed_charges__goods_receipt_id" ON "erp_landed_charges"("goods_receipt_id");

-- CreateIndex
CREATE INDEX "ix_erp_landed_charges__factory_id" ON "erp_landed_charges"("factory_id");

-- CreateIndex
CREATE INDEX "ix_erp_landed_charges__partner_id" ON "erp_landed_charges"("partner_id");

-- CreateIndex
CREATE INDEX "ix_erp_landed_charges__created_by" ON "erp_landed_charges"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_landed_charge_lines__charge_id__goods_receipt_line_id" ON "erp_landed_charge_lines"("charge_id", "goods_receipt_line_id");

-- CreateIndex
CREATE INDEX "ix_erp_landed_charge_lines__goods_receipt_line_id" ON "erp_landed_charge_lines"("goods_receipt_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_operation_events__public_id" ON "erp_operation_events"("public_id");

-- CreateIndex
CREATE INDEX "ix_erp_operation_events__operation_id__occurred_at" ON "erp_operation_events"("operation_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ix_erp_operation_events__factory_id__occurred_at" ON "erp_operation_events"("factory_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "ix_erp_operation_events__created_by" ON "erp_operation_events"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_maintenance_plans__public_id" ON "erp_maintenance_plans"("public_id");

-- CreateIndex
CREATE INDEX "ix_erp_maintenance_plans__factory_id__status" ON "erp_maintenance_plans"("factory_id", "status");

-- CreateIndex
CREATE INDEX "ix_erp_maintenance_plans__machine_id" ON "erp_maintenance_plans"("machine_id");

-- CreateIndex
CREATE INDEX "ix_erp_maintenance_plans__created_by" ON "erp_maintenance_plans"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_maintenance_plans__updated_by" ON "erp_maintenance_plans"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_maintenance_plan_parts__plan_id__item_id" ON "erp_maintenance_plan_parts"("plan_id", "item_id");

-- CreateIndex
CREATE INDEX "ix_erp_maintenance_plan_parts__item_id" ON "erp_maintenance_plan_parts"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_maintenance_orders__public_id" ON "erp_maintenance_orders"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_maintenance_orders__factory_id__mt_no" ON "erp_maintenance_orders"("factory_id", "mt_no");

-- CreateIndex
CREATE INDEX "ix_erp_maintenance_orders__factory_id__status__reported_at" ON "erp_maintenance_orders"("factory_id", "status", "reported_at" DESC);

-- CreateIndex
CREATE INDEX "ix_erp_maintenance_orders__machine_id__status" ON "erp_maintenance_orders"("machine_id", "status");

-- CreateIndex
CREATE INDEX "ix_erp_maintenance_orders__plan_id" ON "erp_maintenance_orders"("plan_id");

-- CreateIndex
CREATE INDEX "ix_erp_maintenance_orders__reported_by" ON "erp_maintenance_orders"("reported_by");

-- CreateIndex
CREATE INDEX "ix_erp_maintenance_orders__updated_by" ON "erp_maintenance_orders"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_maintenance_photos__order_id__file_id" ON "erp_maintenance_photos"("order_id", "file_id");

-- CreateIndex
CREATE INDEX "ix_erp_maintenance_photos__file_id" ON "erp_maintenance_photos"("file_id");

-- CreateIndex
CREATE INDEX "ix_erp_maintenance_photos__created_by" ON "erp_maintenance_photos"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_maintenance_parts__public_id" ON "erp_maintenance_parts"("public_id");

-- CreateIndex
CREATE INDEX "ix_erp_maintenance_parts__order_id" ON "erp_maintenance_parts"("order_id");

-- CreateIndex
CREATE INDEX "ix_erp_maintenance_parts__item_id" ON "erp_maintenance_parts"("item_id");

-- CreateIndex
CREATE INDEX "ix_erp_maintenance_parts__warehouse_id" ON "erp_maintenance_parts"("warehouse_id");

-- CreateIndex
CREATE INDEX "ix_erp_maintenance_parts__created_by" ON "erp_maintenance_parts"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_doc_folders__public_id" ON "erp_doc_folders"("public_id");

-- CreateIndex
CREATE INDEX "ix_erp_doc_folders__factory_id__parent_id" ON "erp_doc_folders"("factory_id", "parent_id");

-- CreateIndex
CREATE INDEX "ix_erp_doc_folders__parent_id" ON "erp_doc_folders"("parent_id");

-- CreateIndex
CREATE INDEX "ix_erp_doc_folders__created_by" ON "erp_doc_folders"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_docs__public_id" ON "erp_docs"("public_id");

-- CreateIndex
CREATE INDEX "ix_erp_docs__factory_id__folder_id" ON "erp_docs"("factory_id", "folder_id");

-- CreateIndex
CREATE INDEX "ix_erp_docs__factory_id__link_type__link_public_id" ON "erp_docs"("factory_id", "link_type", "link_public_id");

-- CreateIndex
CREATE INDEX "ix_erp_docs__factory_id__expires_on" ON "erp_docs"("factory_id", "expires_on");

-- CreateIndex
CREATE INDEX "ix_erp_docs__folder_id" ON "erp_docs"("folder_id");

-- CreateIndex
CREATE INDEX "ix_erp_docs__created_by" ON "erp_docs"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_docs__updated_by" ON "erp_docs"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_doc_versions__public_id" ON "erp_doc_versions"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_doc_versions__doc_id__version" ON "erp_doc_versions"("doc_id", "version");

-- CreateIndex
CREATE INDEX "ix_erp_doc_versions__file_id" ON "erp_doc_versions"("file_id");

-- CreateIndex
CREATE INDEX "ix_erp_doc_versions__created_by" ON "erp_doc_versions"("created_by");

-- AddForeignKey
ALTER TABLE "erp_price_breaks" ADD CONSTRAINT "fk_erp_price_breaks__item_supplier_id" FOREIGN KEY ("item_supplier_id") REFERENCES "erp_item_suppliers"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_price_breaks" ADD CONSTRAINT "fk_erp_price_breaks__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_alerts" ADD CONSTRAINT "fk_erp_alerts__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_alerts" ADD CONSTRAINT "fk_erp_alerts__acknowledged_by" FOREIGN KEY ("acknowledged_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_rfqs" ADD CONSTRAINT "fk_erp_rfqs__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_rfqs" ADD CONSTRAINT "fk_erp_rfqs__purchase_request_id" FOREIGN KEY ("purchase_request_id") REFERENCES "erp_purchase_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_rfqs" ADD CONSTRAINT "fk_erp_rfqs__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_rfqs" ADD CONSTRAINT "fk_erp_rfqs__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_rfq_lines" ADD CONSTRAINT "fk_erp_rfq_lines__rfq_id" FOREIGN KEY ("rfq_id") REFERENCES "erp_rfqs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_rfq_lines" ADD CONSTRAINT "fk_erp_rfq_lines__item_id" FOREIGN KEY ("item_id") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_rfq_suppliers" ADD CONSTRAINT "fk_erp_rfq_suppliers__rfq_id" FOREIGN KEY ("rfq_id") REFERENCES "erp_rfqs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_rfq_suppliers" ADD CONSTRAINT "fk_erp_rfq_suppliers__supplier_id" FOREIGN KEY ("supplier_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_rfq_suppliers" ADD CONSTRAINT "fk_erp_rfq_suppliers__recorded_by" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_rfq_quotes" ADD CONSTRAINT "fk_erp_rfq_quotes__rfq_supplier_id" FOREIGN KEY ("rfq_supplier_id") REFERENCES "erp_rfq_suppliers"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_rfq_quotes" ADD CONSTRAINT "fk_erp_rfq_quotes__rfq_line_id" FOREIGN KEY ("rfq_line_id") REFERENCES "erp_rfq_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_rfq_quotes" ADD CONSTRAINT "fk_erp_rfq_quotes__purchase_order_line_id" FOREIGN KEY ("purchase_order_line_id") REFERENCES "erp_purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_landed_charges" ADD CONSTRAINT "fk_erp_landed_charges__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_landed_charges" ADD CONSTRAINT "fk_erp_landed_charges__goods_receipt_id" FOREIGN KEY ("goods_receipt_id") REFERENCES "erp_goods_receipts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_landed_charges" ADD CONSTRAINT "fk_erp_landed_charges__partner_id" FOREIGN KEY ("partner_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_landed_charges" ADD CONSTRAINT "fk_erp_landed_charges__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_landed_charge_lines" ADD CONSTRAINT "fk_erp_landed_charge_lines__charge_id" FOREIGN KEY ("charge_id") REFERENCES "erp_landed_charges"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_landed_charge_lines" ADD CONSTRAINT "fk_erp_landed_charge_lines__goods_receipt_line_id" FOREIGN KEY ("goods_receipt_line_id") REFERENCES "erp_goods_receipt_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_operation_events" ADD CONSTRAINT "fk_erp_operation_events__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_operation_events" ADD CONSTRAINT "fk_erp_operation_events__operation_id" FOREIGN KEY ("operation_id") REFERENCES "erp_production_operations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_operation_events" ADD CONSTRAINT "fk_erp_operation_events__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_maintenance_plans" ADD CONSTRAINT "fk_erp_maintenance_plans__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_maintenance_plans" ADD CONSTRAINT "fk_erp_maintenance_plans__machine_id" FOREIGN KEY ("machine_id") REFERENCES "factory_machines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_maintenance_plans" ADD CONSTRAINT "fk_erp_maintenance_plans__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_maintenance_plans" ADD CONSTRAINT "fk_erp_maintenance_plans__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_maintenance_plan_parts" ADD CONSTRAINT "fk_erp_maintenance_plan_parts__plan_id" FOREIGN KEY ("plan_id") REFERENCES "erp_maintenance_plans"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_maintenance_plan_parts" ADD CONSTRAINT "fk_erp_maintenance_plan_parts__item_id" FOREIGN KEY ("item_id") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_maintenance_orders" ADD CONSTRAINT "fk_erp_maintenance_orders__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_maintenance_orders" ADD CONSTRAINT "fk_erp_maintenance_orders__machine_id" FOREIGN KEY ("machine_id") REFERENCES "factory_machines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_maintenance_orders" ADD CONSTRAINT "fk_erp_maintenance_orders__plan_id" FOREIGN KEY ("plan_id") REFERENCES "erp_maintenance_plans"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_maintenance_orders" ADD CONSTRAINT "fk_erp_maintenance_orders__reported_by" FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_maintenance_orders" ADD CONSTRAINT "fk_erp_maintenance_orders__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_maintenance_photos" ADD CONSTRAINT "fk_erp_maintenance_photos__order_id" FOREIGN KEY ("order_id") REFERENCES "erp_maintenance_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_maintenance_photos" ADD CONSTRAINT "fk_erp_maintenance_photos__file_id" FOREIGN KEY ("file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_maintenance_photos" ADD CONSTRAINT "fk_erp_maintenance_photos__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_maintenance_parts" ADD CONSTRAINT "fk_erp_maintenance_parts__order_id" FOREIGN KEY ("order_id") REFERENCES "erp_maintenance_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_maintenance_parts" ADD CONSTRAINT "fk_erp_maintenance_parts__item_id" FOREIGN KEY ("item_id") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_maintenance_parts" ADD CONSTRAINT "fk_erp_maintenance_parts__warehouse_id" FOREIGN KEY ("warehouse_id") REFERENCES "erp_warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_maintenance_parts" ADD CONSTRAINT "fk_erp_maintenance_parts__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_doc_folders" ADD CONSTRAINT "fk_erp_doc_folders__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_doc_folders" ADD CONSTRAINT "fk_erp_doc_folders__parent_id" FOREIGN KEY ("parent_id") REFERENCES "erp_doc_folders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_doc_folders" ADD CONSTRAINT "fk_erp_doc_folders__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_docs" ADD CONSTRAINT "fk_erp_docs__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_docs" ADD CONSTRAINT "fk_erp_docs__folder_id" FOREIGN KEY ("folder_id") REFERENCES "erp_doc_folders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_docs" ADD CONSTRAINT "fk_erp_docs__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_docs" ADD CONSTRAINT "fk_erp_docs__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_doc_versions" ADD CONSTRAINT "fk_erp_doc_versions__doc_id" FOREIGN KEY ("doc_id") REFERENCES "erp_docs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_doc_versions" ADD CONSTRAINT "fk_erp_doc_versions__file_id" FOREIGN KEY ("file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_doc_versions" ADD CONSTRAINT "fk_erp_doc_versions__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- Hand-written checks and triggers (D-346 – D-356).
-- D-351: links that existed before the approved supplier list are approved (grandfathered).
UPDATE erp_item_suppliers SET approval = 'approved', approved_at = now(),
       approval_note = 'อนุมัติอัตโนมัติเมื่อเปิดใช้รายชื่อผู้ขายที่อนุมัติ (D-351)';

-- Landed cost revaluations carry no quantity; maintenance issues go out (D-350, D-355).
ALTER TABLE erp_stock_movements DROP CONSTRAINT ck_erp_stock_movements__quantity,
  ADD CONSTRAINT ck_erp_stock_movements__quantity CHECK (quantity <> 0 OR kind::text = 'landed_cost');
ALTER TABLE erp_stock_movements DROP CONSTRAINT ck_erp_stock_movements__sign,
  ADD CONSTRAINT ck_erp_stock_movements__sign CHECK (
    (kind::text IN ('receipt', 'return', 'transfer_in', 'opening', 'production_return', 'production_receipt') AND quantity > 0)
    OR (kind::text IN ('issue', 'transfer_out', 'production_issue', 'maintenance_issue') AND quantity < 0)
    OR (kind::text = 'landed_cost' AND quantity = 0)
    OR kind::text IN ('adjustment', 'count'));

ALTER TABLE erp_factory_settings
  ADD CONSTRAINT ck_erp_factory_settings__price_alert_pct CHECK (price_alert_pct >= 0 AND price_alert_pct <= 100),
  ADD CONSTRAINT ck_erp_factory_settings__quote_expiry_days CHECK (quote_expiry_days BETWEEN 0 AND 90);

ALTER TABLE erp_item_suppliers
  ADD CONSTRAINT ck_erp_item_suppliers__approval CHECK (approval::text <> 'approved' OR approved_at IS NOT NULL);

ALTER TABLE erp_price_breaks
  ADD CONSTRAINT ck_erp_price_breaks__min_qty CHECK (min_qty > 0),
  ADD CONSTRAINT ck_erp_price_breaks__unit_price CHECK (unit_price >= 0);

ALTER TABLE erp_rfq_lines
  ADD CONSTRAINT ck_erp_rfq_lines__quantity CHECK (quantity > 0);
ALTER TABLE erp_rfq_quotes
  ADD CONSTRAINT ck_erp_rfq_quotes__price CHECK (unit_price >= 0 AND factor > 0),
  ADD CONSTRAINT ck_erp_rfq_quotes__min_order_qty CHECK (min_order_qty IS NULL OR min_order_qty > 0),
  ADD CONSTRAINT ck_erp_rfq_quotes__lead_time_days CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  ADD CONSTRAINT ck_erp_rfq_quotes__awarded CHECK (purchase_order_line_id IS NULL OR awarded);

ALTER TABLE erp_goods_receipt_lines
  ADD CONSTRAINT ck_erp_goods_receipt_lines__rejected_quantity CHECK (rejected_quantity >= 0),
  ADD CONSTRAINT ck_erp_goods_receipt_lines__landed_amount CHECK (landed_amount >= 0);
ALTER TABLE erp_goods_receipts
  ADD CONSTRAINT ck_erp_goods_receipts__charges_total CHECK (charges_total >= 0);

ALTER TABLE erp_landed_charges
  ADD CONSTRAINT ck_erp_landed_charges__amount CHECK (amount > 0 AND absorbed >= 0 AND absorbed <= amount),
  ADD CONSTRAINT ck_erp_landed_charges__at_receipt CHECK (NOT at_receipt OR absorbed = amount);
ALTER TABLE erp_landed_charge_lines
  ADD CONSTRAINT ck_erp_landed_charge_lines__amount CHECK (amount >= 0 AND absorbed >= 0 AND absorbed <= amount);
CREATE TRIGGER tg_erp_landed_charges__append_only BEFORE UPDATE OR DELETE ON erp_landed_charges
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER tg_erp_landed_charge_lines__append_only BEFORE UPDATE OR DELETE ON erp_landed_charge_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE erp_production_operations
  ADD CONSTRAINT ck_erp_production_operations__schedule CHECK (
    (scheduled_start IS NULL AND scheduled_end IS NULL)
    OR (scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL AND scheduled_end >= scheduled_start)),
  ADD CONSTRAINT ck_erp_production_operations__paused_minutes CHECK (paused_minutes >= 0);

ALTER TABLE erp_operation_events
  ADD CONSTRAINT ck_erp_operation_events__reason CHECK ((kind::text = 'pause') = (reason IS NOT NULL)),
  ADD CONSTRAINT ck_erp_operation_events__quantities CHECK (
    (good_qty IS NULL OR good_qty >= 0) AND (scrap_qty IS NULL OR scrap_qty >= 0));
CREATE TRIGGER tg_erp_operation_events__append_only BEFORE UPDATE OR DELETE ON erp_operation_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE erp_maintenance_plans
  ADD CONSTRAINT ck_erp_maintenance_plans__interval CHECK (
    (every_days IS NOT NULL OR every_impressions IS NOT NULL)
    AND (every_days IS NULL OR every_days > 0) AND (every_impressions IS NULL OR every_impressions > 0)),
  ADD CONSTRAINT ck_erp_maintenance_plans__duration_minutes CHECK (duration_minutes > 0);
ALTER TABLE erp_maintenance_plan_parts
  ADD CONSTRAINT ck_erp_maintenance_plan_parts__quantity CHECK (quantity > 0);
ALTER TABLE erp_maintenance_orders
  ADD CONSTRAINT ck_erp_maintenance_orders__window CHECK (
    (scheduled_start IS NULL AND scheduled_end IS NULL)
    OR (scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL AND scheduled_end > scheduled_start)),
  ADD CONSTRAINT ck_erp_maintenance_orders__plan CHECK ((kind::text = 'preventive') = (plan_id IS NOT NULL)),
  ADD CONSTRAINT ck_erp_maintenance_orders__downtime_minutes CHECK (downtime_minutes IS NULL OR downtime_minutes >= 0);
-- One open preventive order per plan (D-355).
CREATE UNIQUE INDEX ux_erp_maintenance_orders__plan_id__open ON erp_maintenance_orders (plan_id)
  WHERE plan_id IS NOT NULL AND status IN ('open', 'scheduled', 'in_progress');
ALTER TABLE erp_maintenance_parts
  ADD CONSTRAINT ck_erp_maintenance_parts__quantity CHECK (quantity > 0 AND unit_cost >= 0 AND value >= 0);
CREATE TRIGGER tg_erp_maintenance_parts__append_only BEFORE UPDATE OR DELETE ON erp_maintenance_parts
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Folder names are unique among their siblings (D-356).
CREATE UNIQUE INDEX ux_erp_doc_folders__factory_id__parent_id__name ON erp_doc_folders (factory_id, parent_id, lower(name))
  WHERE parent_id IS NOT NULL;
CREATE UNIQUE INDEX ux_erp_doc_folders__factory_id__name__root ON erp_doc_folders (factory_id, lower(name))
  WHERE parent_id IS NULL;
ALTER TABLE erp_docs
  ADD CONSTRAINT ck_erp_docs__link CHECK ((link_type IS NULL) = (link_public_id IS NULL)),
  ADD CONSTRAINT ck_erp_docs__remind_days CHECK (remind_days BETWEEN 0 AND 365),
  ADD CONSTRAINT ck_erp_docs__current_version CHECK (current_version >= 1);
CREATE TRIGGER tg_erp_doc_versions__append_only BEFORE UPDATE OR DELETE ON erp_doc_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
