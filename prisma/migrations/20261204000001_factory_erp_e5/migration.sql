-- E5 Packio Factory ERP (D-372 – D-383): quality checks and templates, NCRs, machine rates and job costing,
-- OEE and the owner's dashboard, shifts and operator skills, Packio support grants.

-- AlterEnum
ALTER TYPE "erp_document_type" ADD VALUE 'qc';
ALTER TYPE "erp_document_type" ADD VALUE 'ncr';

-- AlterEnum
ALTER TYPE "erp_alert_kind" ADD VALUE 'ncr_overdue';
ALTER TYPE "erp_alert_kind" ADD VALUE 'oee_low';

-- CreateEnum
CREATE TYPE "erp_check_kind" AS ENUM ('incoming', 'in_process', 'final', 'other');

-- CreateEnum
CREATE TYPE "erp_check_result" AS ENUM ('pending', 'pass', 'fail', 'conditional');

-- CreateEnum
CREATE TYPE "erp_checkpoint_type" AS ENUM ('pass_fail', 'measurement', 'note');

-- CreateEnum
CREATE TYPE "erp_checkpoint_outcome" AS ENUM ('pass', 'fail', 'na');

-- CreateEnum
CREATE TYPE "erp_ncr_source" AS ENUM ('quality_check', 'goods_receipt', 'production_order', 'customer_complaint', 'internal');

-- CreateEnum
CREATE TYPE "erp_ncr_severity" AS ENUM ('minor', 'major', 'critical');

-- CreateEnum
CREATE TYPE "erp_ncr_disposition" AS ENUM ('rework', 'scrap', 'return_to_supplier', 'use_as_is', 'hold');

-- CreateEnum
CREATE TYPE "erp_ncr_status" AS ENUM ('open', 'in_progress', 'verified', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "erp_skill_level" AS ENUM ('learner', 'competent', 'expert');

-- AlterTable
ALTER TABLE "erp_factory_settings" ADD COLUMN "labour_rate_per_hour" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN "overhead_pct" DECIMAL(7,4) NOT NULL DEFAULT 0,
ADD COLUMN "daily_summary" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "oee_alert_pct" DECIMAL(7,4) NOT NULL DEFAULT 50;

-- CreateTable
CREATE TABLE "erp_inspection_templates" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "item_id" BIGINT,
    "name" TEXT NOT NULL,
    "kind" "erp_check_kind" NOT NULL,
    "sample_size_hint" TEXT,
    "note" TEXT,
    "status" "erp_record_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_inspection_templates" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_inspection_checkpoints" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "template_id" BIGINT NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" "erp_checkpoint_type" NOT NULL,
    "unit" TEXT,
    "min_value" DECIMAL(14,4),
    "max_value" DECIMAL(14,4),
    "target_value" DECIMAL(14,4),
    "instruction" TEXT,

    CONSTRAINT "pk_erp_inspection_checkpoints" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_quality_checks" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "template_id" BIGINT,
    "item_id" BIGINT,
    "goods_receipt_line_id" BIGINT,
    "operation_id" BIGINT,
    "production_order_id" BIGINT,
    "supplier_id" BIGINT,
    "inspector_id" BIGINT NOT NULL,
    "qc_no" TEXT NOT NULL,
    "kind" "erp_check_kind" NOT NULL,
    "result" "erp_check_result" NOT NULL DEFAULT 'pending',
    "result_overridden" BOOLEAN NOT NULL DEFAULT false,
    "sample_size" DECIMAL(14,3),
    "inspected_qty" DECIMAL(14,3),
    "accepted_qty" DECIMAL(14,3),
    "rejected_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "photo_file_ids" JSONB NOT NULL DEFAULT '[]',
    "inspected_at" TIMESTAMPTZ(6) NOT NULL,
    "lot_no" TEXT,
    "pdf_file_id" BIGINT,
    "pdf_version" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_quality_checks" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_quality_checkpoints" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "check_id" BIGINT NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" "erp_checkpoint_type" NOT NULL,
    "unit" TEXT,
    "min_value" DECIMAL(14,4),
    "max_value" DECIMAL(14,4),
    "target_value" DECIMAL(14,4),
    "measured" DECIMAL(14,4),
    "outcome" "erp_checkpoint_outcome",
    "note" TEXT,

    CONSTRAINT "pk_erp_quality_checkpoints" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_ncrs" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "check_id" BIGINT,
    "supplier_id" BIGINT,
    "customer_id" BIGINT,
    "item_id" BIGINT,
    "machine_id" BIGINT,
    "production_order_id" BIGINT,
    "goods_receipt_id" BIGINT,
    "warehouse_id" BIGINT,
    "owner_id" BIGINT,
    "verified_by_id" BIGINT,
    "ncr_no" TEXT NOT NULL,
    "source" "erp_ncr_source" NOT NULL,
    "severity" "erp_ncr_severity" NOT NULL DEFAULT 'minor',
    "status" "erp_ncr_status" NOT NULL DEFAULT 'open',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3),
    "unit" "erp_unit",
    "disposition" "erp_ncr_disposition",
    "disposition_note" TEXT,
    "disposition_at" TIMESTAMPTZ(6),
    "root_cause" TEXT,
    "corrective_action" TEXT,
    "preventive_action" TEXT,
    "action_due_on" DATE,
    "verified_at" TIMESTAMPTZ(6),
    "verification_note" TEXT,
    "closed_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "photo_file_ids" JSONB NOT NULL DEFAULT '[]',
    "last_overdue_alert_on" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_ncrs" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_machine_rates" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "machine_id" BIGINT NOT NULL,
    "hourly_rate" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_machine_rates" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_shifts" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "days" JSONB NOT NULL DEFAULT '[1,2,3,4,5,6]',
    "note" TEXT,
    "status" "erp_record_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_shifts" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_operator_skills" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "machine_id" BIGINT NOT NULL,
    "level" "erp_skill_level" NOT NULL DEFAULT 'learner',
    "certified_on" DATE,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_operator_skills" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_support_grants" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "revoked_by_id" BIGINT,
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoke_reason" TEXT,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "last_viewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_support_grants" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_support_views" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "grant_id" BIGINT NOT NULL,
    "staff_id" BIGINT NOT NULL,
    "viewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "what" TEXT NOT NULL,

    CONSTRAINT "pk_erp_support_views" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_inspection_templates__public_id" ON "erp_inspection_templates"("public_id");

-- CreateIndex
CREATE INDEX "ix_erp_inspection_templates__factory_id__kind__status" ON "erp_inspection_templates"("factory_id", "kind", "status");

-- CreateIndex
CREATE INDEX "ix_erp_inspection_templates__item_id" ON "erp_inspection_templates"("item_id");

-- CreateIndex
CREATE INDEX "ix_erp_inspection_templates__created_by_id" ON "erp_inspection_templates"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_inspection_templates__updated_by_id" ON "erp_inspection_templates"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_inspection_checkpoints__template_id__seq" ON "erp_inspection_checkpoints"("template_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_quality_checks__public_id" ON "erp_quality_checks"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_quality_checks__factory_id__qc_no" ON "erp_quality_checks"("factory_id", "qc_no");

-- CreateIndex
CREATE INDEX "ix_erp_quality_checks__factory_id__kind__result__inspected_at" ON "erp_quality_checks"("factory_id", "kind", "result", "inspected_at" DESC);

-- CreateIndex
CREATE INDEX "ix_erp_quality_checks__template_id" ON "erp_quality_checks"("template_id");

-- CreateIndex
CREATE INDEX "ix_erp_quality_checks__item_id" ON "erp_quality_checks"("item_id");

-- CreateIndex
CREATE INDEX "ix_erp_quality_checks__goods_receipt_line_id" ON "erp_quality_checks"("goods_receipt_line_id");

-- CreateIndex
CREATE INDEX "ix_erp_quality_checks__operation_id" ON "erp_quality_checks"("operation_id");

-- CreateIndex
CREATE INDEX "ix_erp_quality_checks__production_order_id" ON "erp_quality_checks"("production_order_id");

-- CreateIndex
CREATE INDEX "ix_erp_quality_checks__supplier_id" ON "erp_quality_checks"("supplier_id");

-- CreateIndex
CREATE INDEX "ix_erp_quality_checks__inspector_id" ON "erp_quality_checks"("inspector_id");

-- CreateIndex
CREATE INDEX "ix_erp_quality_checks__pdf_file_id" ON "erp_quality_checks"("pdf_file_id");

-- CreateIndex
CREATE INDEX "ix_erp_quality_checks__created_by_id" ON "erp_quality_checks"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_quality_checks__updated_by_id" ON "erp_quality_checks"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_quality_checkpoints__check_id__seq" ON "erp_quality_checkpoints"("check_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_ncrs__public_id" ON "erp_ncrs"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_ncrs__factory_id__ncr_no" ON "erp_ncrs"("factory_id", "ncr_no");

-- CreateIndex
CREATE INDEX "ix_erp_ncrs__factory_id__status__action_due_on" ON "erp_ncrs"("factory_id", "status", "action_due_on");

-- CreateIndex
CREATE INDEX "ix_erp_ncrs__check_id" ON "erp_ncrs"("check_id");

-- CreateIndex
CREATE INDEX "ix_erp_ncrs__supplier_id" ON "erp_ncrs"("supplier_id");

-- CreateIndex
CREATE INDEX "ix_erp_ncrs__customer_id" ON "erp_ncrs"("customer_id");

-- CreateIndex
CREATE INDEX "ix_erp_ncrs__item_id" ON "erp_ncrs"("item_id");

-- CreateIndex
CREATE INDEX "ix_erp_ncrs__machine_id" ON "erp_ncrs"("machine_id");

-- CreateIndex
CREATE INDEX "ix_erp_ncrs__production_order_id" ON "erp_ncrs"("production_order_id");

-- CreateIndex
CREATE INDEX "ix_erp_ncrs__goods_receipt_id" ON "erp_ncrs"("goods_receipt_id");

-- CreateIndex
CREATE INDEX "ix_erp_ncrs__warehouse_id" ON "erp_ncrs"("warehouse_id");

-- CreateIndex
CREATE INDEX "ix_erp_ncrs__owner_id" ON "erp_ncrs"("owner_id");

-- CreateIndex
CREATE INDEX "ix_erp_ncrs__verified_by_id" ON "erp_ncrs"("verified_by_id");

-- CreateIndex
CREATE INDEX "ix_erp_ncrs__created_by_id" ON "erp_ncrs"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_ncrs__updated_by_id" ON "erp_ncrs"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_machine_rates__public_id" ON "erp_machine_rates"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_machine_rates__factory_id__machine_id" ON "erp_machine_rates"("factory_id", "machine_id");

-- CreateIndex
CREATE INDEX "ix_erp_machine_rates__machine_id" ON "erp_machine_rates"("machine_id");

-- CreateIndex
CREATE INDEX "ix_erp_machine_rates__created_by_id" ON "erp_machine_rates"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_machine_rates__updated_by_id" ON "erp_machine_rates"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_shifts__public_id" ON "erp_shifts"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_shifts__factory_id__name" ON "erp_shifts"("factory_id", "name");

-- CreateIndex
CREATE INDEX "ix_erp_shifts__created_by_id" ON "erp_shifts"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_shifts__updated_by_id" ON "erp_shifts"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_operator_skills__public_id" ON "erp_operator_skills"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_operator_skills__factory_id__user_id__machine_id" ON "erp_operator_skills"("factory_id", "user_id", "machine_id");

-- CreateIndex
CREATE INDEX "ix_erp_operator_skills__user_id" ON "erp_operator_skills"("user_id");

-- CreateIndex
CREATE INDEX "ix_erp_operator_skills__machine_id" ON "erp_operator_skills"("machine_id");

-- CreateIndex
CREATE INDEX "ix_erp_operator_skills__created_by_id" ON "erp_operator_skills"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_operator_skills__updated_by_id" ON "erp_operator_skills"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_support_grants__public_id" ON "erp_support_grants"("public_id");

-- CreateIndex
CREATE INDEX "ix_erp_support_grants__factory_id__expires_at" ON "erp_support_grants"("factory_id", "expires_at" DESC);

-- CreateIndex
CREATE INDEX "ix_erp_support_grants__revoked_by_id" ON "erp_support_grants"("revoked_by_id");

-- CreateIndex
CREATE INDEX "ix_erp_support_grants__created_by_id" ON "erp_support_grants"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_support_grants__updated_by_id" ON "erp_support_grants"("updated_by");

-- CreateIndex
CREATE INDEX "ix_erp_support_views__grant_id__viewed_at" ON "erp_support_views"("grant_id", "viewed_at" DESC);

-- CreateIndex
CREATE INDEX "ix_erp_support_views__staff_id" ON "erp_support_views"("staff_id");

-- AddForeignKey
ALTER TABLE "erp_inspection_templates" ADD CONSTRAINT "fk_erp_inspection_templates__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_inspection_templates" ADD CONSTRAINT "fk_erp_inspection_templates__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_inspection_templates" ADD CONSTRAINT "fk_erp_inspection_templates__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_inspection_templates" ADD CONSTRAINT "fk_erp_inspection_templates__item_id" FOREIGN KEY ("item_id") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_inspection_checkpoints" ADD CONSTRAINT "fk_erp_inspection_checkpoints__template_id" FOREIGN KEY ("template_id") REFERENCES "erp_inspection_templates"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_quality_checks" ADD CONSTRAINT "fk_erp_quality_checks__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_quality_checks" ADD CONSTRAINT "fk_erp_quality_checks__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_quality_checks" ADD CONSTRAINT "fk_erp_quality_checks__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_quality_checks" ADD CONSTRAINT "fk_erp_quality_checks__template_id" FOREIGN KEY ("template_id") REFERENCES "erp_inspection_templates"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_quality_checks" ADD CONSTRAINT "fk_erp_quality_checks__item_id" FOREIGN KEY ("item_id") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_quality_checks" ADD CONSTRAINT "fk_erp_quality_checks__goods_receipt_line_id" FOREIGN KEY ("goods_receipt_line_id") REFERENCES "erp_goods_receipt_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_quality_checks" ADD CONSTRAINT "fk_erp_quality_checks__operation_id" FOREIGN KEY ("operation_id") REFERENCES "erp_production_operations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_quality_checks" ADD CONSTRAINT "fk_erp_quality_checks__production_order_id" FOREIGN KEY ("production_order_id") REFERENCES "erp_production_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_quality_checks" ADD CONSTRAINT "fk_erp_quality_checks__supplier_id" FOREIGN KEY ("supplier_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_quality_checks" ADD CONSTRAINT "fk_erp_quality_checks__inspector_id" FOREIGN KEY ("inspector_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_quality_checks" ADD CONSTRAINT "fk_erp_quality_checks__pdf_file_id" FOREIGN KEY ("pdf_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_quality_checkpoints" ADD CONSTRAINT "fk_erp_quality_checkpoints__check_id" FOREIGN KEY ("check_id") REFERENCES "erp_quality_checks"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_ncrs" ADD CONSTRAINT "fk_erp_ncrs__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_ncrs" ADD CONSTRAINT "fk_erp_ncrs__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_ncrs" ADD CONSTRAINT "fk_erp_ncrs__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_ncrs" ADD CONSTRAINT "fk_erp_ncrs__check_id" FOREIGN KEY ("check_id") REFERENCES "erp_quality_checks"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_ncrs" ADD CONSTRAINT "fk_erp_ncrs__supplier_id" FOREIGN KEY ("supplier_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_ncrs" ADD CONSTRAINT "fk_erp_ncrs__customer_id" FOREIGN KEY ("customer_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_ncrs" ADD CONSTRAINT "fk_erp_ncrs__item_id" FOREIGN KEY ("item_id") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_ncrs" ADD CONSTRAINT "fk_erp_ncrs__machine_id" FOREIGN KEY ("machine_id") REFERENCES "factory_machines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_ncrs" ADD CONSTRAINT "fk_erp_ncrs__production_order_id" FOREIGN KEY ("production_order_id") REFERENCES "erp_production_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_ncrs" ADD CONSTRAINT "fk_erp_ncrs__goods_receipt_id" FOREIGN KEY ("goods_receipt_id") REFERENCES "erp_goods_receipts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_ncrs" ADD CONSTRAINT "fk_erp_ncrs__warehouse_id" FOREIGN KEY ("warehouse_id") REFERENCES "erp_warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_ncrs" ADD CONSTRAINT "fk_erp_ncrs__owner_id" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_ncrs" ADD CONSTRAINT "fk_erp_ncrs__verified_by_id" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_machine_rates" ADD CONSTRAINT "fk_erp_machine_rates__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_machine_rates" ADD CONSTRAINT "fk_erp_machine_rates__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_machine_rates" ADD CONSTRAINT "fk_erp_machine_rates__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_machine_rates" ADD CONSTRAINT "fk_erp_machine_rates__machine_id" FOREIGN KEY ("machine_id") REFERENCES "factory_machines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_shifts" ADD CONSTRAINT "fk_erp_shifts__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_shifts" ADD CONSTRAINT "fk_erp_shifts__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_shifts" ADD CONSTRAINT "fk_erp_shifts__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_operator_skills" ADD CONSTRAINT "fk_erp_operator_skills__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_operator_skills" ADD CONSTRAINT "fk_erp_operator_skills__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_operator_skills" ADD CONSTRAINT "fk_erp_operator_skills__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_operator_skills" ADD CONSTRAINT "fk_erp_operator_skills__user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_operator_skills" ADD CONSTRAINT "fk_erp_operator_skills__machine_id" FOREIGN KEY ("machine_id") REFERENCES "factory_machines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_support_grants" ADD CONSTRAINT "fk_erp_support_grants__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_support_grants" ADD CONSTRAINT "fk_erp_support_grants__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_support_grants" ADD CONSTRAINT "fk_erp_support_grants__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_support_grants" ADD CONSTRAINT "fk_erp_support_grants__revoked_by_id" FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_support_views" ADD CONSTRAINT "fk_erp_support_views__grant_id" FOREIGN KEY ("grant_id") REFERENCES "erp_support_grants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_support_views" ADD CONSTRAINT "fk_erp_support_views__staff_id" FOREIGN KEY ("staff_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- Hand-written checks (D-372 – D-383).
ALTER TABLE erp_factory_settings
  ADD CONSTRAINT ck_erp_factory_settings__costing CHECK (labour_rate_per_hour >= 0 AND overhead_pct BETWEEN 0 AND 500),
  ADD CONSTRAINT ck_erp_factory_settings__oee_alert_pct CHECK (oee_alert_pct BETWEEN 0 AND 100);

ALTER TABLE erp_inspection_checkpoints
  ADD CONSTRAINT ck_erp_inspection_checkpoints__seq CHECK (seq >= 1),
  ADD CONSTRAINT ck_erp_inspection_checkpoints__limits CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value);

ALTER TABLE erp_quality_checks
  ADD CONSTRAINT ck_erp_quality_checks__quantities CHECK (
    (sample_size IS NULL OR sample_size >= 0) AND (inspected_qty IS NULL OR inspected_qty >= 0)
    AND (accepted_qty IS NULL OR accepted_qty >= 0) AND rejected_qty >= 0),
  ADD CONSTRAINT ck_erp_quality_checks__incoming CHECK (kind::text <> 'incoming' OR goods_receipt_line_id IS NOT NULL OR item_id IS NOT NULL);
ALTER TABLE erp_quality_checkpoints
  ADD CONSTRAINT ck_erp_quality_checkpoints__seq CHECK (seq >= 1);

ALTER TABLE erp_ncrs
  ADD CONSTRAINT ck_erp_ncrs__quantity CHECK (quantity IS NULL OR quantity > 0),
  ADD CONSTRAINT ck_erp_ncrs__closed CHECK (status::text <> 'closed' OR closed_at IS NOT NULL),
  ADD CONSTRAINT ck_erp_ncrs__cancelled CHECK (status::text <> 'cancelled' OR cancel_reason IS NOT NULL);

ALTER TABLE erp_machine_rates
  ADD CONSTRAINT ck_erp_machine_rates__hourly_rate CHECK (hourly_rate >= 0);

ALTER TABLE erp_shifts
  ADD CONSTRAINT ck_erp_shifts__times CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

ALTER TABLE erp_support_grants
  ADD CONSTRAINT ck_erp_support_grants__window CHECK (expires_at > created_at AND expires_at <= created_at + interval '7 days 1 minute'),
  ADD CONSTRAINT ck_erp_support_grants__views CHECK (view_count >= 0);
