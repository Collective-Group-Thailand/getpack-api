-- D-464 / D-465 (agent portal pack, Phase 0): no commission cap (margin alert only), progressive s.50(1) withholding
-- for individual agents decided on statement approval, ล.ย.01 declarations, a juristic agent's tax invoice before
-- approval, and the monthly commission ÷ gross margin KPI. Additive only; rollback: down.sql in this folder.
-- CreateEnum
CREATE TYPE "sales_agent_wht_method" AS ENUM ('progressive_40_2', 'juristic_service', 'payroll');

-- CreateEnum
CREATE TYPE "sales_agent_tax_declaration_status" AS ENUM ('submitted', 'accepted', 'rejected');

-- AlterTable
ALTER TABLE "payable_items" ADD COLUMN     "wht_commission_fixed" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "sales_agent_commissions" ADD COLUMN     "margin_alert" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sales_agent_statements" ADD COLUMN     "tax_invoice_file_id" BIGINT,
ADD COLUMN     "tax_invoice_no" TEXT,
ADD COLUMN     "wht_allowances" DECIMAL(14,2),
ADD COLUMN     "wht_amount" DECIMAL(14,2),
ADD COLUMN     "wht_annual_tax" DECIMAL(14,2),
ADD COLUMN     "wht_method" "sales_agent_wht_method",
ADD COLUMN     "wht_projected" DECIMAL(14,2),
ADD COLUMN     "wht_ytd_paid" DECIMAL(14,2);

-- CreateTable
CREATE TABLE "sales_agent_tax_declarations" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "agent_id" BIGINT NOT NULL,
    "tax_year" SMALLINT NOT NULL,
    "allowances" JSONB NOT NULL,
    "evidence_file_ids" BIGINT[] DEFAULT ARRAY[]::BIGINT[],
    "status" "sales_agent_tax_declaration_status" NOT NULL DEFAULT 'submitted',
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" BIGINT,
    "decision_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_sales_agent_tax_declarations" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_agent_margin_kpis" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "period" DATE NOT NULL,
    "order_count" INTEGER NOT NULL,
    "commission_amount" DECIMAL(14,2) NOT NULL,
    "gross_margin" DECIMAL(14,2) NOT NULL,
    "ratio_pct" DECIMAL(9,4),
    "alert_count" INTEGER NOT NULL,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_sales_agent_margin_kpis" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_tax_declarations__public_id" ON "sales_agent_tax_declarations"("public_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_tax_declarations__agent_id__tax_year__status" ON "sales_agent_tax_declarations"("agent_id", "tax_year", "status");

-- CreateIndex
CREATE INDEX "ix_sales_agent_tax_declarations__status__submitted_at" ON "sales_agent_tax_declarations"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "ix_sales_agent_tax_declarations__decided_by" ON "sales_agent_tax_declarations"("decided_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_margin_kpis__period" ON "sales_agent_margin_kpis"("period");

-- CreateIndex
CREATE INDEX "ix_sales_agent_statements__tax_invoice_file_id" ON "sales_agent_statements"("tax_invoice_file_id");

-- AddForeignKey
ALTER TABLE "sales_agent_statements" ADD CONSTRAINT "fk_sales_agent_statements__tax_invoice_file_id" FOREIGN KEY ("tax_invoice_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_tax_declarations" ADD CONSTRAINT "fk_sales_agent_tax_declarations__agent_id" FOREIGN KEY ("agent_id") REFERENCES "sales_agents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_tax_declarations" ADD CONSTRAINT "fk_sales_agent_tax_declarations__decided_by" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

