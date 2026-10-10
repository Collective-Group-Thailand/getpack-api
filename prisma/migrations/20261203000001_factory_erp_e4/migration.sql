-- E4 Packio Factory ERP (D-359 – D-371): CRM, quotations, sales orders, delivery notes, the factory's own
-- invoices / tax invoices, credit and debit notes, receipts and refunds, billing notes, 50 ทวิ certificates,
-- sales targets; settings for the factory's documents.

-- AlterEnum
ALTER TYPE "erp_movement_kind" ADD VALUE 'sales_issue';
ALTER TYPE "erp_movement_kind" ADD VALUE 'sales_return';

-- AlterEnum
ALTER TYPE "erp_document_type" ADD VALUE 'qt';
ALTER TYPE "erp_document_type" ADD VALUE 'so';
ALTER TYPE "erp_document_type" ADD VALUE 'do';
ALTER TYPE "erp_document_type" ADD VALUE 'iv';
ALTER TYPE "erp_document_type" ADD VALUE 'cn';
ALTER TYPE "erp_document_type" ADD VALUE 'dr';
ALTER TYPE "erp_document_type" ADD VALUE 'rc';
ALTER TYPE "erp_document_type" ADD VALUE 'bn';
ALTER TYPE "erp_document_type" ADD VALUE 'wht';

-- AlterEnum
ALTER TYPE "erp_alert_kind" ADD VALUE 'quote_follow_up';
ALTER TYPE "erp_alert_kind" ADD VALUE 'invoice_overdue';
ALTER TYPE "erp_alert_kind" ADD VALUE 'activity_overdue';

-- CreateEnum
CREATE TYPE "erp_lead_source" AS ENUM ('walk_in', 'phone', 'line', 'facebook', 'website', 'referral', 'exhibition', 'packio', 'other');

-- CreateEnum
CREATE TYPE "erp_lead_stage" AS ENUM ('new', 'contacted', 'qualified', 'converted', 'lost');

-- CreateEnum
CREATE TYPE "erp_opportunity_stage" AS ENUM ('prospecting', 'proposal', 'negotiation', 'won', 'lost');

-- CreateEnum
CREATE TYPE "erp_activity_kind" AS ENUM ('call', 'visit', 'meeting', 'email', 'line', 'task', 'note');

-- CreateEnum
CREATE TYPE "erp_quotation_status" AS ENUM ('draft', 'sent', 'accepted', 'rejected', 'expired', 'superseded', 'cancelled');

-- CreateEnum
CREATE TYPE "erp_sales_order_status" AS ENUM ('draft', 'confirmed', 'partially_delivered', 'delivered', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "erp_fulfilment" AS ENUM ('stock', 'make', 'service');

-- CreateEnum
CREATE TYPE "erp_delivery_status" AS ENUM ('draft', 'issued', 'delivered', 'cancelled');

-- CreateEnum
CREATE TYPE "erp_invoice_form" AS ENUM ('invoice', 'invoice_receipt');

-- CreateEnum
CREATE TYPE "erp_sales_invoice_status" AS ENUM ('draft', 'issued', 'partially_paid', 'paid', 'voided');

-- CreateEnum
CREATE TYPE "erp_sales_note_kind" AS ENUM ('credit', 'debit');

-- CreateEnum
CREATE TYPE "erp_sales_note_reason" AS ENUM ('price_reduced', 'goods_returned', 'defective', 'discount_after_sale', 'overcharged', 'price_increased', 'undercharged', 'extra_goods', 'other');

-- CreateEnum
CREATE TYPE "erp_issued_status" AS ENUM ('draft', 'issued', 'voided');

-- CreateEnum
CREATE TYPE "erp_receipt_kind" AS ENUM ('receipt', 'refund');

-- CreateEnum
CREATE TYPE "erp_receipt_status" AS ENUM ('issued', 'cancelled');

-- CreateEnum
CREATE TYPE "erp_billing_status" AS ENUM ('issued', 'cancelled');

-- CreateEnum
CREATE TYPE "erp_entity_type" AS ENUM ('juristic', 'individual');

-- CreateEnum
CREATE TYPE "erp_wht_form" AS ENUM ('pnd3', 'pnd53');

-- CreateEnum
CREATE TYPE "erp_wht_income_type" AS ENUM ('fees_commission', 'rent', 'hire_of_work', 'transport', 'advertising', 'service', 'prize', 'other');

-- AlterTable
ALTER TABLE "erp_trading_partners" ADD COLUMN "entity_type" "erp_entity_type" NOT NULL DEFAULT 'juristic',
ADD COLUMN "salesperson_id" BIGINT;

-- AlterTable
ALTER TABLE "erp_factory_settings" ADD COLUMN "document_logo_file_id" BIGINT,
ADD COLUMN "document_footer" TEXT,
ADD COLUMN "bank_details" TEXT,
ADD COLUMN "signatory_name" TEXT,
ADD COLUMN "quote_valid_days" INTEGER NOT NULL DEFAULT 30;

-- CreateIndex
CREATE INDEX "ix_erp_trading_partners__salesperson_id" ON "erp_trading_partners"("salesperson_id");

-- CreateIndex
CREATE INDEX "ix_erp_factory_settings__document_logo_file_id" ON "erp_factory_settings"("document_logo_file_id");

-- AddForeignKey
ALTER TABLE "erp_trading_partners" ADD CONSTRAINT "fk_erp_trading_partners__salesperson_id" FOREIGN KEY ("salesperson_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_factory_settings" ADD CONSTRAINT "fk_erp_factory_settings__document_logo_file_id" FOREIGN KEY ("document_logo_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- CreateTable
CREATE TABLE "erp_leads" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "salesperson_id" BIGINT,
    "customer_id" BIGINT,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "line_id" TEXT,
    "address" TEXT,
    "source" "erp_lead_source" NOT NULL DEFAULT 'other',
    "stage" "erp_lead_stage" NOT NULL DEFAULT 'new',
    "expected_value" DECIMAL(14,2),
    "lost_reason" TEXT,
    "note" TEXT,
    "converted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_leads" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_opportunities" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "customer_id" BIGINT,
    "lead_id" BIGINT,
    "salesperson_id" BIGINT,
    "title" TEXT NOT NULL,
    "stage" "erp_opportunity_stage" NOT NULL DEFAULT 'prospecting',
    "value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "probability_pct" INTEGER NOT NULL DEFAULT 10,
    "expected_close_on" DATE,
    "lost_reason" TEXT,
    "note" TEXT,
    "won_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_opportunities" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_activities" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "lead_id" BIGINT,
    "opportunity_id" BIGINT,
    "customer_id" BIGINT,
    "assignee_id" BIGINT NOT NULL,
    "kind" "erp_activity_kind" NOT NULL,
    "subject" TEXT NOT NULL,
    "detail" TEXT,
    "due_at" TIMESTAMPTZ(6),
    "done_at" TIMESTAMPTZ(6),
    "outcome" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_activities" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_quotations" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "opportunity_id" BIGINT,
    "salesperson_id" BIGINT,
    "previous_id" BIGINT,
    "quote_no" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" "erp_quotation_status" NOT NULL DEFAULT 'draft',
    "quote_date" DATE NOT NULL,
    "valid_until" DATE NOT NULL,
    "payment_term_days" INTEGER NOT NULL DEFAULT 0,
    "lead_time_days" INTEGER,
    "terms" TEXT,
    "note" TEXT,
    "vat_mode" "erp_vat_mode" NOT NULL DEFAULT 'exclusive',
    "vat_rate_pct" DECIMAL(7,4) NOT NULL DEFAULT 7,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "buyer_snapshot" JSONB,
    "sent_at" TIMESTAMPTZ(6),
    "link_token_hash" BYTEA,
    "link_expires_at" TIMESTAMPTZ(6),
    "accepted_at" TIMESTAMPTZ(6),
    "accepted_name" TEXT,
    "accepted_position" TEXT,
    "accepted_via" TEXT,
    "customer_po_no" TEXT,
    "rejected_at" TIMESTAMPTZ(6),
    "reject_reason" TEXT,
    "cancel_reason" TEXT,
    "pdf_file_id" BIGINT,
    "pdf_version" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_quotations" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_quotation_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "quotation_id" BIGINT NOT NULL,
    "item_id" BIGINT,
    "line_no" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" "erp_unit" NOT NULL,
    "unit_price" DECIMAL(18,6) NOT NULL,
    "discount_pct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "pk_erp_quotation_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_sales_orders" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "quotation_id" BIGINT,
    "opportunity_id" BIGINT,
    "salesperson_id" BIGINT,
    "warehouse_id" BIGINT NOT NULL,
    "confirmed_by_id" BIGINT,
    "so_no" TEXT NOT NULL,
    "status" "erp_sales_order_status" NOT NULL DEFAULT 'draft',
    "order_date" DATE NOT NULL,
    "delivery_date" DATE,
    "customer_po_no" TEXT,
    "payment_term_days" INTEGER NOT NULL DEFAULT 0,
    "ship_to_address" TEXT,
    "note" TEXT,
    "vat_mode" "erp_vat_mode" NOT NULL DEFAULT 'exclusive',
    "vat_rate_pct" DECIMAL(7,4) NOT NULL DEFAULT 7,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "confirmed_at" TIMESTAMPTZ(6),
    "credit_override_reason" TEXT,
    "closed_at" TIMESTAMPTZ(6),
    "close_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_sales_orders" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_sales_order_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "sales_order_id" BIGINT NOT NULL,
    "item_id" BIGINT,
    "production_order_id" BIGINT,
    "line_no" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" "erp_unit" NOT NULL,
    "unit_price" DECIMAL(18,6) NOT NULL,
    "discount_pct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL,
    "fulfilment" "erp_fulfilment" NOT NULL DEFAULT 'stock',
    "reserved_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "delivered_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "invoiced_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "pk_erp_sales_order_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_delivery_notes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "sales_order_id" BIGINT NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "warehouse_id" BIGINT NOT NULL,
    "issued_by_id" BIGINT,
    "pod_file_id" BIGINT,
    "do_no" TEXT NOT NULL,
    "status" "erp_delivery_status" NOT NULL DEFAULT 'draft',
    "deliver_on" DATE NOT NULL,
    "ship_to_address" TEXT,
    "vehicle" TEXT,
    "note" TEXT,
    "issued_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "received_by" TEXT,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "pdf_file_id" BIGINT,
    "pdf_version" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_delivery_notes" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_delivery_note_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "delivery_note_id" BIGINT NOT NULL,
    "sales_order_line_id" BIGINT NOT NULL,
    "item_id" BIGINT,
    "line_no" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" "erp_unit" NOT NULL,
    "unit_cost" DECIMAL(18,6),
    "cost_amount" DECIMAL(14,2),
    "invoiced_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "pk_erp_delivery_note_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_sales_invoices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "sales_order_id" BIGINT,
    "salesperson_id" BIGINT,
    "issued_by_id" BIGINT,
    "invoice_no" TEXT,
    "form" "erp_invoice_form" NOT NULL DEFAULT 'invoice',
    "is_tax_invoice" BOOLEAN NOT NULL DEFAULT false,
    "status" "erp_sales_invoice_status" NOT NULL DEFAULT 'draft',
    "issue_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "payment_term_days" INTEGER NOT NULL DEFAULT 0,
    "customer_po_no" TEXT,
    "note" TEXT,
    "vat_mode" "erp_vat_mode" NOT NULL DEFAULT 'exclusive',
    "vat_rate_pct" DECIMAL(7,4) NOT NULL DEFAULT 7,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credited_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "debited_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "received_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "seller_snapshot" JSONB,
    "buyer_snapshot" JSONB,
    "issued_at" TIMESTAMPTZ(6),
    "voided_at" TIMESTAMPTZ(6),
    "void_reason" TEXT,
    "last_overdue_alert_on" DATE,
    "pdf_file_id" BIGINT,
    "pdf_version" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_sales_invoices" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_sales_invoice_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "invoice_id" BIGINT NOT NULL,
    "item_id" BIGINT,
    "delivery_note_line_id" BIGINT,
    "sales_order_line_id" BIGINT,
    "line_no" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" "erp_unit" NOT NULL,
    "unit_price" DECIMAL(18,6) NOT NULL,
    "discount_pct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "pk_erp_sales_invoice_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_sales_notes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "invoice_id" BIGINT NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "warehouse_id" BIGINT,
    "issued_by_id" BIGINT,
    "kind" "erp_sales_note_kind" NOT NULL,
    "note_no" TEXT,
    "status" "erp_issued_status" NOT NULL DEFAULT 'draft',
    "issue_date" DATE NOT NULL,
    "reason" "erp_sales_note_reason" NOT NULL,
    "reason_text" TEXT,
    "original_value" DECIMAL(14,2) NOT NULL,
    "correct_value" DECIMAL(14,2) NOT NULL,
    "difference" DECIMAL(14,2) NOT NULL,
    "vat_rate_pct" DECIMAL(7,4) NOT NULL DEFAULT 7,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "is_tax_document" BOOLEAN NOT NULL DEFAULT false,
    "seller_snapshot" JSONB,
    "buyer_snapshot" JSONB,
    "issued_at" TIMESTAMPTZ(6),
    "voided_at" TIMESTAMPTZ(6),
    "void_reason" TEXT,
    "pdf_file_id" BIGINT,
    "pdf_version" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_sales_notes" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_sales_note_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "note_id" BIGINT NOT NULL,
    "item_id" BIGINT,
    "line_no" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3),
    "unit" "erp_unit",
    "amount" DECIMAL(14,2) NOT NULL,
    "return_qty" DECIMAL(14,3),

    CONSTRAINT "pk_erp_sales_note_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_customer_receipts" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "wht_file_id" BIGINT,
    "receipt_no" TEXT NOT NULL,
    "kind" "erp_receipt_kind" NOT NULL DEFAULT 'receipt',
    "status" "erp_receipt_status" NOT NULL DEFAULT 'issued',
    "received_on" DATE NOT NULL,
    "method" "erp_payment_method" NOT NULL,
    "reference" TEXT,
    "cheque_no" TEXT,
    "cheque_bank" TEXT,
    "cheque_date" DATE,
    "amount" DECIMAL(14,2) NOT NULL,
    "wht_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "wht_cert_no" TEXT,
    "wht_cert_date" DATE,
    "note" TEXT,
    "seller_snapshot" JSONB,
    "buyer_snapshot" JSONB,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "pdf_file_id" BIGINT,
    "pdf_version" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,

    CONSTRAINT "pk_erp_customer_receipts" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_receipt_allocations" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "receipt_id" BIGINT NOT NULL,
    "invoice_id" BIGINT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "pk_erp_receipt_allocations" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_billing_notes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "billing_no" TEXT NOT NULL,
    "status" "erp_billing_status" NOT NULL DEFAULT 'issued',
    "billing_date" DATE NOT NULL,
    "collect_on" DATE,
    "total" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "buyer_snapshot" JSONB,
    "seller_snapshot" JSONB,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "pdf_file_id" BIGINT,
    "pdf_version" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,

    CONSTRAINT "pk_erp_billing_notes" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_billing_note_invoices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "billing_note_id" BIGINT NOT NULL,
    "invoice_id" BIGINT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "pk_erp_billing_note_invoices" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_wht_certificates" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "payment_id" BIGINT NOT NULL,
    "supplier_id" BIGINT NOT NULL,
    "cert_no" TEXT NOT NULL,
    "status" "erp_issued_status" NOT NULL DEFAULT 'issued',
    "form" "erp_wht_form" NOT NULL,
    "paid_on" DATE NOT NULL,
    "base_amount" DECIMAL(14,2) NOT NULL,
    "wht_amount" DECIMAL(14,2) NOT NULL,
    "payer_snapshot" JSONB NOT NULL,
    "payee_snapshot" JSONB NOT NULL,
    "voided_at" TIMESTAMPTZ(6),
    "void_reason" TEXT,
    "pdf_file_id" BIGINT,
    "pdf_version" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,

    CONSTRAINT "pk_erp_wht_certificates" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_wht_certificate_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "certificate_id" BIGINT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "income_type" "erp_wht_income_type" NOT NULL,
    "description" TEXT,
    "rate_pct" DECIMAL(7,4) NOT NULL,
    "base_amount" DECIMAL(14,2) NOT NULL,
    "wht_amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "pk_erp_wht_certificate_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_sales_targets" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "salesperson_id" BIGINT NOT NULL,
    "month" DATE NOT NULL,
    "target_net" DECIMAL(14,2) NOT NULL,
    "commission_pct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_sales_targets" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_leads__public_id" ON "erp_leads"("public_id");

-- CreateIndex
CREATE INDEX "ix_erp_leads__factory_id__stage__created_at" ON "erp_leads"("factory_id", "stage", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_erp_leads__salesperson_id" ON "erp_leads"("salesperson_id");

-- CreateIndex
CREATE INDEX "ix_erp_leads__customer_id" ON "erp_leads"("customer_id");

-- CreateIndex
CREATE INDEX "ix_erp_leads__created_by_id" ON "erp_leads"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_leads__updated_by_id" ON "erp_leads"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_opportunities__public_id" ON "erp_opportunities"("public_id");

-- CreateIndex
CREATE INDEX "ix_erp_opportunities__factory_id__stage__expected_close_on" ON "erp_opportunities"("factory_id", "stage", "expected_close_on");

-- CreateIndex
CREATE INDEX "ix_erp_opportunities__customer_id" ON "erp_opportunities"("customer_id");

-- CreateIndex
CREATE INDEX "ix_erp_opportunities__lead_id" ON "erp_opportunities"("lead_id");

-- CreateIndex
CREATE INDEX "ix_erp_opportunities__salesperson_id" ON "erp_opportunities"("salesperson_id");

-- CreateIndex
CREATE INDEX "ix_erp_opportunities__created_by_id" ON "erp_opportunities"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_opportunities__updated_by_id" ON "erp_opportunities"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_activities__public_id" ON "erp_activities"("public_id");

-- CreateIndex
CREATE INDEX "ix_erp_activities__factory_id__assignee_id__done_at__due_at" ON "erp_activities"("factory_id", "assignee_id", "done_at", "due_at");

-- CreateIndex
CREATE INDEX "ix_erp_activities__lead_id" ON "erp_activities"("lead_id");

-- CreateIndex
CREATE INDEX "ix_erp_activities__opportunity_id" ON "erp_activities"("opportunity_id");

-- CreateIndex
CREATE INDEX "ix_erp_activities__customer_id" ON "erp_activities"("customer_id");

-- CreateIndex
CREATE INDEX "ix_erp_activities__assignee_id" ON "erp_activities"("assignee_id");

-- CreateIndex
CREATE INDEX "ix_erp_activities__created_by_id" ON "erp_activities"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_activities__updated_by_id" ON "erp_activities"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_quotations__public_id" ON "erp_quotations"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_quotations__factory_id__quote_no__revision" ON "erp_quotations"("factory_id", "quote_no", "revision");

-- CreateIndex
CREATE INDEX "ix_erp_quotations__factory_id__status__quote_date" ON "erp_quotations"("factory_id", "status", "quote_date" DESC);

-- CreateIndex
CREATE INDEX "ix_erp_quotations__customer_id" ON "erp_quotations"("customer_id");

-- CreateIndex
CREATE INDEX "ix_erp_quotations__opportunity_id" ON "erp_quotations"("opportunity_id");

-- CreateIndex
CREATE INDEX "ix_erp_quotations__salesperson_id" ON "erp_quotations"("salesperson_id");

-- CreateIndex
CREATE INDEX "ix_erp_quotations__previous_id" ON "erp_quotations"("previous_id");

-- CreateIndex
CREATE INDEX "ix_erp_quotations__pdf_file_id" ON "erp_quotations"("pdf_file_id");

-- CreateIndex
CREATE INDEX "ix_erp_quotations__created_by_id" ON "erp_quotations"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_quotations__updated_by_id" ON "erp_quotations"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_quotation_lines__quotation_id__line_no" ON "erp_quotation_lines"("quotation_id", "line_no");

-- CreateIndex
CREATE INDEX "ix_erp_quotation_lines__item_id" ON "erp_quotation_lines"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_sales_orders__public_id" ON "erp_sales_orders"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_sales_orders__factory_id__so_no" ON "erp_sales_orders"("factory_id", "so_no");

-- CreateIndex
CREATE INDEX "ix_erp_sales_orders__factory_id__status__order_date" ON "erp_sales_orders"("factory_id", "status", "order_date" DESC);

-- CreateIndex
CREATE INDEX "ix_erp_sales_orders__customer_id" ON "erp_sales_orders"("customer_id");

-- CreateIndex
CREATE INDEX "ix_erp_sales_orders__quotation_id" ON "erp_sales_orders"("quotation_id");

-- CreateIndex
CREATE INDEX "ix_erp_sales_orders__opportunity_id" ON "erp_sales_orders"("opportunity_id");

-- CreateIndex
CREATE INDEX "ix_erp_sales_orders__salesperson_id" ON "erp_sales_orders"("salesperson_id");

-- CreateIndex
CREATE INDEX "ix_erp_sales_orders__warehouse_id" ON "erp_sales_orders"("warehouse_id");

-- CreateIndex
CREATE INDEX "ix_erp_sales_orders__confirmed_by_id" ON "erp_sales_orders"("confirmed_by_id");

-- CreateIndex
CREATE INDEX "ix_erp_sales_orders__created_by_id" ON "erp_sales_orders"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_sales_orders__updated_by_id" ON "erp_sales_orders"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_sales_order_lines__sales_order_id__line_no" ON "erp_sales_order_lines"("sales_order_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_sales_order_lines__production_order_id" ON "erp_sales_order_lines"("production_order_id");

-- CreateIndex
CREATE INDEX "ix_erp_sales_order_lines__item_id" ON "erp_sales_order_lines"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_delivery_notes__public_id" ON "erp_delivery_notes"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_delivery_notes__factory_id__do_no" ON "erp_delivery_notes"("factory_id", "do_no");

-- CreateIndex
CREATE INDEX "ix_erp_delivery_notes__factory_id__status__deliver_on" ON "erp_delivery_notes"("factory_id", "status", "deliver_on" DESC);

-- CreateIndex
CREATE INDEX "ix_erp_delivery_notes__sales_order_id" ON "erp_delivery_notes"("sales_order_id");

-- CreateIndex
CREATE INDEX "ix_erp_delivery_notes__customer_id" ON "erp_delivery_notes"("customer_id");

-- CreateIndex
CREATE INDEX "ix_erp_delivery_notes__warehouse_id" ON "erp_delivery_notes"("warehouse_id");

-- CreateIndex
CREATE INDEX "ix_erp_delivery_notes__issued_by_id" ON "erp_delivery_notes"("issued_by_id");

-- CreateIndex
CREATE INDEX "ix_erp_delivery_notes__pod_file_id" ON "erp_delivery_notes"("pod_file_id");

-- CreateIndex
CREATE INDEX "ix_erp_delivery_notes__pdf_file_id" ON "erp_delivery_notes"("pdf_file_id");

-- CreateIndex
CREATE INDEX "ix_erp_delivery_notes__created_by_id" ON "erp_delivery_notes"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_delivery_notes__updated_by_id" ON "erp_delivery_notes"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_delivery_note_lines__delivery_note_id__line_no" ON "erp_delivery_note_lines"("delivery_note_id", "line_no");

-- CreateIndex
CREATE INDEX "ix_erp_delivery_note_lines__sales_order_line_id" ON "erp_delivery_note_lines"("sales_order_line_id");

-- CreateIndex
CREATE INDEX "ix_erp_delivery_note_lines__item_id" ON "erp_delivery_note_lines"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_sales_invoices__public_id" ON "erp_sales_invoices"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_sales_invoices__factory_id__invoice_no" ON "erp_sales_invoices"("factory_id", "invoice_no");

-- CreateIndex
CREATE INDEX "ix_erp_sales_invoices__factory_id__status__issue_date" ON "erp_sales_invoices"("factory_id", "status", "issue_date" DESC);

-- CreateIndex
CREATE INDEX "ix_erp_sales_invoices__factory_id__customer_id__status" ON "erp_sales_invoices"("factory_id", "customer_id", "status");

-- CreateIndex
CREATE INDEX "ix_erp_sales_invoices__customer_id" ON "erp_sales_invoices"("customer_id");

-- CreateIndex
CREATE INDEX "ix_erp_sales_invoices__sales_order_id" ON "erp_sales_invoices"("sales_order_id");

-- CreateIndex
CREATE INDEX "ix_erp_sales_invoices__salesperson_id" ON "erp_sales_invoices"("salesperson_id");

-- CreateIndex
CREATE INDEX "ix_erp_sales_invoices__issued_by_id" ON "erp_sales_invoices"("issued_by_id");

-- CreateIndex
CREATE INDEX "ix_erp_sales_invoices__pdf_file_id" ON "erp_sales_invoices"("pdf_file_id");

-- CreateIndex
CREATE INDEX "ix_erp_sales_invoices__created_by_id" ON "erp_sales_invoices"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_sales_invoices__updated_by_id" ON "erp_sales_invoices"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_sales_invoice_lines__invoice_id__line_no" ON "erp_sales_invoice_lines"("invoice_id", "line_no");

-- CreateIndex
CREATE INDEX "ix_erp_sales_invoice_lines__item_id" ON "erp_sales_invoice_lines"("item_id");

-- CreateIndex
CREATE INDEX "ix_erp_sales_invoice_lines__delivery_note_line_id" ON "erp_sales_invoice_lines"("delivery_note_line_id");

-- CreateIndex
CREATE INDEX "ix_erp_sales_invoice_lines__sales_order_line_id" ON "erp_sales_invoice_lines"("sales_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_sales_notes__public_id" ON "erp_sales_notes"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_sales_notes__factory_id__note_no" ON "erp_sales_notes"("factory_id", "note_no");

-- CreateIndex
CREATE INDEX "ix_erp_sales_notes__factory_id__kind__status__issue_date" ON "erp_sales_notes"("factory_id", "kind", "status", "issue_date" DESC);

-- CreateIndex
CREATE INDEX "ix_erp_sales_notes__invoice_id" ON "erp_sales_notes"("invoice_id");

-- CreateIndex
CREATE INDEX "ix_erp_sales_notes__customer_id" ON "erp_sales_notes"("customer_id");

-- CreateIndex
CREATE INDEX "ix_erp_sales_notes__warehouse_id" ON "erp_sales_notes"("warehouse_id");

-- CreateIndex
CREATE INDEX "ix_erp_sales_notes__issued_by_id" ON "erp_sales_notes"("issued_by_id");

-- CreateIndex
CREATE INDEX "ix_erp_sales_notes__pdf_file_id" ON "erp_sales_notes"("pdf_file_id");

-- CreateIndex
CREATE INDEX "ix_erp_sales_notes__created_by_id" ON "erp_sales_notes"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_sales_notes__updated_by_id" ON "erp_sales_notes"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_sales_note_lines__note_id__line_no" ON "erp_sales_note_lines"("note_id", "line_no");

-- CreateIndex
CREATE INDEX "ix_erp_sales_note_lines__item_id" ON "erp_sales_note_lines"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_customer_receipts__public_id" ON "erp_customer_receipts"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_customer_receipts__factory_id__receipt_no" ON "erp_customer_receipts"("factory_id", "receipt_no");

-- CreateIndex
CREATE INDEX "ix_erp_customer_receipts__factory_id__received_on" ON "erp_customer_receipts"("factory_id", "received_on" DESC);

-- CreateIndex
CREATE INDEX "ix_erp_customer_receipts__customer_id" ON "erp_customer_receipts"("customer_id");

-- CreateIndex
CREATE INDEX "ix_erp_customer_receipts__wht_file_id" ON "erp_customer_receipts"("wht_file_id");

-- CreateIndex
CREATE INDEX "ix_erp_customer_receipts__pdf_file_id" ON "erp_customer_receipts"("pdf_file_id");

-- CreateIndex
CREATE INDEX "ix_erp_customer_receipts__created_by_id" ON "erp_customer_receipts"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_receipt_allocations__receipt_id__invoice_id" ON "erp_receipt_allocations"("receipt_id", "invoice_id");

-- CreateIndex
CREATE INDEX "ix_erp_receipt_allocations__invoice_id" ON "erp_receipt_allocations"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_billing_notes__public_id" ON "erp_billing_notes"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_billing_notes__factory_id__billing_no" ON "erp_billing_notes"("factory_id", "billing_no");

-- CreateIndex
CREATE INDEX "ix_erp_billing_notes__factory_id__billing_date" ON "erp_billing_notes"("factory_id", "billing_date" DESC);

-- CreateIndex
CREATE INDEX "ix_erp_billing_notes__customer_id" ON "erp_billing_notes"("customer_id");

-- CreateIndex
CREATE INDEX "ix_erp_billing_notes__pdf_file_id" ON "erp_billing_notes"("pdf_file_id");

-- CreateIndex
CREATE INDEX "ix_erp_billing_notes__created_by_id" ON "erp_billing_notes"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_billing_note_invoices__billing_note_id__invoice_id" ON "erp_billing_note_invoices"("billing_note_id", "invoice_id");

-- CreateIndex
CREATE INDEX "ix_erp_billing_note_invoices__invoice_id" ON "erp_billing_note_invoices"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_wht_certificates__public_id" ON "erp_wht_certificates"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_wht_certificates__factory_id__cert_no" ON "erp_wht_certificates"("factory_id", "cert_no");

-- CreateIndex
CREATE INDEX "ix_erp_wht_certificates__factory_id__paid_on" ON "erp_wht_certificates"("factory_id", "paid_on" DESC);

-- CreateIndex
CREATE INDEX "ix_erp_wht_certificates__payment_id" ON "erp_wht_certificates"("payment_id");

-- CreateIndex
CREATE INDEX "ix_erp_wht_certificates__supplier_id" ON "erp_wht_certificates"("supplier_id");

-- CreateIndex
CREATE INDEX "ix_erp_wht_certificates__pdf_file_id" ON "erp_wht_certificates"("pdf_file_id");

-- CreateIndex
CREATE INDEX "ix_erp_wht_certificates__created_by_id" ON "erp_wht_certificates"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_wht_certificate_lines__certificate_id__line_no" ON "erp_wht_certificate_lines"("certificate_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_sales_targets__public_id" ON "erp_sales_targets"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_sales_targets__factory_id__salesperson_id__month" ON "erp_sales_targets"("factory_id", "salesperson_id", "month");

-- CreateIndex
CREATE INDEX "ix_erp_sales_targets__salesperson_id" ON "erp_sales_targets"("salesperson_id");

-- CreateIndex
CREATE INDEX "ix_erp_sales_targets__created_by_id" ON "erp_sales_targets"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_sales_targets__updated_by_id" ON "erp_sales_targets"("updated_by");

-- AddForeignKey
ALTER TABLE "erp_leads" ADD CONSTRAINT "fk_erp_leads__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_leads" ADD CONSTRAINT "fk_erp_leads__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_leads" ADD CONSTRAINT "fk_erp_leads__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_leads" ADD CONSTRAINT "fk_erp_leads__salesperson_id" FOREIGN KEY ("salesperson_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_leads" ADD CONSTRAINT "fk_erp_leads__customer_id" FOREIGN KEY ("customer_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_opportunities" ADD CONSTRAINT "fk_erp_opportunities__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_opportunities" ADD CONSTRAINT "fk_erp_opportunities__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_opportunities" ADD CONSTRAINT "fk_erp_opportunities__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_opportunities" ADD CONSTRAINT "fk_erp_opportunities__customer_id" FOREIGN KEY ("customer_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_opportunities" ADD CONSTRAINT "fk_erp_opportunities__lead_id" FOREIGN KEY ("lead_id") REFERENCES "erp_leads"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_opportunities" ADD CONSTRAINT "fk_erp_opportunities__salesperson_id" FOREIGN KEY ("salesperson_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_activities" ADD CONSTRAINT "fk_erp_activities__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_activities" ADD CONSTRAINT "fk_erp_activities__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_activities" ADD CONSTRAINT "fk_erp_activities__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_activities" ADD CONSTRAINT "fk_erp_activities__lead_id" FOREIGN KEY ("lead_id") REFERENCES "erp_leads"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_activities" ADD CONSTRAINT "fk_erp_activities__opportunity_id" FOREIGN KEY ("opportunity_id") REFERENCES "erp_opportunities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_activities" ADD CONSTRAINT "fk_erp_activities__customer_id" FOREIGN KEY ("customer_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_activities" ADD CONSTRAINT "fk_erp_activities__assignee_id" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_quotations" ADD CONSTRAINT "fk_erp_quotations__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_quotations" ADD CONSTRAINT "fk_erp_quotations__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_quotations" ADD CONSTRAINT "fk_erp_quotations__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_quotations" ADD CONSTRAINT "fk_erp_quotations__customer_id" FOREIGN KEY ("customer_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_quotations" ADD CONSTRAINT "fk_erp_quotations__opportunity_id" FOREIGN KEY ("opportunity_id") REFERENCES "erp_opportunities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_quotations" ADD CONSTRAINT "fk_erp_quotations__salesperson_id" FOREIGN KEY ("salesperson_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_quotations" ADD CONSTRAINT "fk_erp_quotations__previous_id" FOREIGN KEY ("previous_id") REFERENCES "erp_quotations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_quotations" ADD CONSTRAINT "fk_erp_quotations__pdf_file_id" FOREIGN KEY ("pdf_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_quotation_lines" ADD CONSTRAINT "fk_erp_quotation_lines__quotation_id" FOREIGN KEY ("quotation_id") REFERENCES "erp_quotations"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_quotation_lines" ADD CONSTRAINT "fk_erp_quotation_lines__item_id" FOREIGN KEY ("item_id") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_orders" ADD CONSTRAINT "fk_erp_sales_orders__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_orders" ADD CONSTRAINT "fk_erp_sales_orders__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_orders" ADD CONSTRAINT "fk_erp_sales_orders__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_orders" ADD CONSTRAINT "fk_erp_sales_orders__customer_id" FOREIGN KEY ("customer_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_orders" ADD CONSTRAINT "fk_erp_sales_orders__quotation_id" FOREIGN KEY ("quotation_id") REFERENCES "erp_quotations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_orders" ADD CONSTRAINT "fk_erp_sales_orders__opportunity_id" FOREIGN KEY ("opportunity_id") REFERENCES "erp_opportunities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_orders" ADD CONSTRAINT "fk_erp_sales_orders__salesperson_id" FOREIGN KEY ("salesperson_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_orders" ADD CONSTRAINT "fk_erp_sales_orders__warehouse_id" FOREIGN KEY ("warehouse_id") REFERENCES "erp_warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_orders" ADD CONSTRAINT "fk_erp_sales_orders__confirmed_by_id" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_order_lines" ADD CONSTRAINT "fk_erp_sales_order_lines__sales_order_id" FOREIGN KEY ("sales_order_id") REFERENCES "erp_sales_orders"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_order_lines" ADD CONSTRAINT "fk_erp_sales_order_lines__item_id" FOREIGN KEY ("item_id") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_order_lines" ADD CONSTRAINT "fk_erp_sales_order_lines__production_order_id" FOREIGN KEY ("production_order_id") REFERENCES "erp_production_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_delivery_notes" ADD CONSTRAINT "fk_erp_delivery_notes__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_delivery_notes" ADD CONSTRAINT "fk_erp_delivery_notes__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_delivery_notes" ADD CONSTRAINT "fk_erp_delivery_notes__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_delivery_notes" ADD CONSTRAINT "fk_erp_delivery_notes__sales_order_id" FOREIGN KEY ("sales_order_id") REFERENCES "erp_sales_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_delivery_notes" ADD CONSTRAINT "fk_erp_delivery_notes__customer_id" FOREIGN KEY ("customer_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_delivery_notes" ADD CONSTRAINT "fk_erp_delivery_notes__warehouse_id" FOREIGN KEY ("warehouse_id") REFERENCES "erp_warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_delivery_notes" ADD CONSTRAINT "fk_erp_delivery_notes__issued_by_id" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_delivery_notes" ADD CONSTRAINT "fk_erp_delivery_notes__pod_file_id" FOREIGN KEY ("pod_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_delivery_notes" ADD CONSTRAINT "fk_erp_delivery_notes__pdf_file_id" FOREIGN KEY ("pdf_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_delivery_note_lines" ADD CONSTRAINT "fk_erp_delivery_note_lines__delivery_note_id" FOREIGN KEY ("delivery_note_id") REFERENCES "erp_delivery_notes"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_delivery_note_lines" ADD CONSTRAINT "fk_erp_delivery_note_lines__sales_order_line_id" FOREIGN KEY ("sales_order_line_id") REFERENCES "erp_sales_order_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_delivery_note_lines" ADD CONSTRAINT "fk_erp_delivery_note_lines__item_id" FOREIGN KEY ("item_id") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_invoices" ADD CONSTRAINT "fk_erp_sales_invoices__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_invoices" ADD CONSTRAINT "fk_erp_sales_invoices__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_invoices" ADD CONSTRAINT "fk_erp_sales_invoices__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_invoices" ADD CONSTRAINT "fk_erp_sales_invoices__customer_id" FOREIGN KEY ("customer_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_invoices" ADD CONSTRAINT "fk_erp_sales_invoices__sales_order_id" FOREIGN KEY ("sales_order_id") REFERENCES "erp_sales_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_invoices" ADD CONSTRAINT "fk_erp_sales_invoices__salesperson_id" FOREIGN KEY ("salesperson_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_invoices" ADD CONSTRAINT "fk_erp_sales_invoices__issued_by_id" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_invoices" ADD CONSTRAINT "fk_erp_sales_invoices__pdf_file_id" FOREIGN KEY ("pdf_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_invoice_lines" ADD CONSTRAINT "fk_erp_sales_invoice_lines__invoice_id" FOREIGN KEY ("invoice_id") REFERENCES "erp_sales_invoices"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_invoice_lines" ADD CONSTRAINT "fk_erp_sales_invoice_lines__item_id" FOREIGN KEY ("item_id") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_invoice_lines" ADD CONSTRAINT "fk_erp_sales_invoice_lines__delivery_note_line_id" FOREIGN KEY ("delivery_note_line_id") REFERENCES "erp_delivery_note_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_invoice_lines" ADD CONSTRAINT "fk_erp_sales_invoice_lines__sales_order_line_id" FOREIGN KEY ("sales_order_line_id") REFERENCES "erp_sales_order_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_notes" ADD CONSTRAINT "fk_erp_sales_notes__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_notes" ADD CONSTRAINT "fk_erp_sales_notes__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_notes" ADD CONSTRAINT "fk_erp_sales_notes__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_notes" ADD CONSTRAINT "fk_erp_sales_notes__invoice_id" FOREIGN KEY ("invoice_id") REFERENCES "erp_sales_invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_notes" ADD CONSTRAINT "fk_erp_sales_notes__customer_id" FOREIGN KEY ("customer_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_notes" ADD CONSTRAINT "fk_erp_sales_notes__warehouse_id" FOREIGN KEY ("warehouse_id") REFERENCES "erp_warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_notes" ADD CONSTRAINT "fk_erp_sales_notes__issued_by_id" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_notes" ADD CONSTRAINT "fk_erp_sales_notes__pdf_file_id" FOREIGN KEY ("pdf_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_note_lines" ADD CONSTRAINT "fk_erp_sales_note_lines__note_id" FOREIGN KEY ("note_id") REFERENCES "erp_sales_notes"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_note_lines" ADD CONSTRAINT "fk_erp_sales_note_lines__item_id" FOREIGN KEY ("item_id") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_customer_receipts" ADD CONSTRAINT "fk_erp_customer_receipts__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_customer_receipts" ADD CONSTRAINT "fk_erp_customer_receipts__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_customer_receipts" ADD CONSTRAINT "fk_erp_customer_receipts__customer_id" FOREIGN KEY ("customer_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_customer_receipts" ADD CONSTRAINT "fk_erp_customer_receipts__wht_file_id" FOREIGN KEY ("wht_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_customer_receipts" ADD CONSTRAINT "fk_erp_customer_receipts__pdf_file_id" FOREIGN KEY ("pdf_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_receipt_allocations" ADD CONSTRAINT "fk_erp_receipt_allocations__receipt_id" FOREIGN KEY ("receipt_id") REFERENCES "erp_customer_receipts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_receipt_allocations" ADD CONSTRAINT "fk_erp_receipt_allocations__invoice_id" FOREIGN KEY ("invoice_id") REFERENCES "erp_sales_invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_billing_notes" ADD CONSTRAINT "fk_erp_billing_notes__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_billing_notes" ADD CONSTRAINT "fk_erp_billing_notes__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_billing_notes" ADD CONSTRAINT "fk_erp_billing_notes__customer_id" FOREIGN KEY ("customer_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_billing_notes" ADD CONSTRAINT "fk_erp_billing_notes__pdf_file_id" FOREIGN KEY ("pdf_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_billing_note_invoices" ADD CONSTRAINT "fk_erp_billing_note_invoices__billing_note_id" FOREIGN KEY ("billing_note_id") REFERENCES "erp_billing_notes"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_billing_note_invoices" ADD CONSTRAINT "fk_erp_billing_note_invoices__invoice_id" FOREIGN KEY ("invoice_id") REFERENCES "erp_sales_invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_wht_certificates" ADD CONSTRAINT "fk_erp_wht_certificates__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_wht_certificates" ADD CONSTRAINT "fk_erp_wht_certificates__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_wht_certificates" ADD CONSTRAINT "fk_erp_wht_certificates__payment_id" FOREIGN KEY ("payment_id") REFERENCES "erp_supplier_payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_wht_certificates" ADD CONSTRAINT "fk_erp_wht_certificates__supplier_id" FOREIGN KEY ("supplier_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_wht_certificates" ADD CONSTRAINT "fk_erp_wht_certificates__pdf_file_id" FOREIGN KEY ("pdf_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_wht_certificate_lines" ADD CONSTRAINT "fk_erp_wht_certificate_lines__certificate_id" FOREIGN KEY ("certificate_id") REFERENCES "erp_wht_certificates"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_targets" ADD CONSTRAINT "fk_erp_sales_targets__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_targets" ADD CONSTRAINT "fk_erp_sales_targets__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_targets" ADD CONSTRAINT "fk_erp_sales_targets__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_sales_targets" ADD CONSTRAINT "fk_erp_sales_targets__salesperson_id" FOREIGN KEY ("salesperson_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- Hand-written checks and triggers (D-359 – D-371).
-- Sales deliveries go out, returns come back (D-362, D-364).
ALTER TABLE erp_stock_movements DROP CONSTRAINT ck_erp_stock_movements__sign,
  ADD CONSTRAINT ck_erp_stock_movements__sign CHECK (
    (kind::text IN ('receipt', 'return', 'transfer_in', 'opening', 'production_return', 'production_receipt', 'sales_return') AND quantity > 0)
    OR (kind::text IN ('issue', 'transfer_out', 'production_issue', 'maintenance_issue', 'sales_issue') AND quantity < 0)
    OR (kind::text = 'landed_cost' AND quantity = 0)
    OR kind::text IN ('adjustment', 'count'));

ALTER TABLE erp_factory_settings
  ADD CONSTRAINT ck_erp_factory_settings__quote_valid_days CHECK (quote_valid_days BETWEEN 1 AND 365);

ALTER TABLE erp_leads
  ADD CONSTRAINT ck_erp_leads__lost CHECK (stage::text = 'lost' OR lost_reason IS NULL),
  ADD CONSTRAINT ck_erp_leads__converted CHECK (stage::text <> 'converted' OR customer_id IS NOT NULL),
  ADD CONSTRAINT ck_erp_leads__expected_value CHECK (expected_value IS NULL OR expected_value >= 0);

ALTER TABLE erp_opportunities
  ADD CONSTRAINT ck_erp_opportunities__party CHECK (num_nonnulls(customer_id, lead_id) >= 1),
  ADD CONSTRAINT ck_erp_opportunities__probability_pct CHECK (probability_pct BETWEEN 0 AND 100),
  ADD CONSTRAINT ck_erp_opportunities__value CHECK (value >= 0),
  ADD CONSTRAINT ck_erp_opportunities__lost CHECK (stage::text = 'lost' OR lost_reason IS NULL);

ALTER TABLE erp_activities
  ADD CONSTRAINT ck_erp_activities__subject CHECK (num_nonnulls(lead_id, opportunity_id, customer_id) = 1);

ALTER TABLE erp_quotations
  ADD CONSTRAINT ck_erp_quotations__revision CHECK (revision >= 1),
  ADD CONSTRAINT ck_erp_quotations__valid_until CHECK (valid_until >= quote_date),
  ADD CONSTRAINT ck_erp_quotations__payment_term_days CHECK (payment_term_days >= 0 AND (lead_time_days IS NULL OR lead_time_days >= 0)),
  ADD CONSTRAINT ck_erp_quotations__totals CHECK (subtotal >= 0 AND vat_amount >= 0 AND total = subtotal + vat_amount),
  ADD CONSTRAINT ck_erp_quotations__accepted CHECK (status::text <> 'accepted' OR accepted_at IS NOT NULL);
CREATE UNIQUE INDEX ux_erp_quotations__link_token_hash ON erp_quotations (link_token_hash) WHERE link_token_hash IS NOT NULL;
ALTER TABLE erp_quotation_lines
  ADD CONSTRAINT ck_erp_quotation_lines__amounts CHECK (
    quantity > 0 AND unit_price >= 0 AND discount_pct >= 0 AND discount_pct <= 100 AND amount >= 0);

ALTER TABLE erp_sales_orders
  ADD CONSTRAINT ck_erp_sales_orders__totals CHECK (subtotal >= 0 AND vat_amount >= 0 AND total = subtotal + vat_amount),
  ADD CONSTRAINT ck_erp_sales_orders__payment_term_days CHECK (payment_term_days >= 0);
ALTER TABLE erp_sales_order_lines
  ADD CONSTRAINT ck_erp_sales_order_lines__amounts CHECK (
    quantity > 0 AND unit_price >= 0 AND discount_pct >= 0 AND discount_pct <= 100 AND amount >= 0),
  ADD CONSTRAINT ck_erp_sales_order_lines__progress CHECK (
    reserved_qty >= 0 AND delivered_qty >= 0 AND invoiced_qty >= 0 AND delivered_qty <= quantity AND invoiced_qty <= quantity),
  ADD CONSTRAINT ck_erp_sales_order_lines__item CHECK (fulfilment::text = 'service' OR item_id IS NOT NULL),
  ADD CONSTRAINT ck_erp_sales_order_lines__production CHECK (production_order_id IS NULL OR fulfilment::text = 'make');

ALTER TABLE erp_delivery_note_lines
  ADD CONSTRAINT ck_erp_delivery_note_lines__quantity CHECK (quantity > 0 AND invoiced_qty >= 0 AND invoiced_qty <= quantity),
  ADD CONSTRAINT ck_erp_delivery_note_lines__cost CHECK ((unit_cost IS NULL) = (cost_amount IS NULL));
ALTER TABLE erp_delivery_notes
  ADD CONSTRAINT ck_erp_delivery_notes__cancel CHECK ((status::text = 'cancelled') = (cancel_reason IS NOT NULL));

ALTER TABLE erp_sales_invoices
  ADD CONSTRAINT ck_erp_sales_invoices__totals CHECK (subtotal >= 0 AND vat_amount >= 0 AND total = subtotal + vat_amount),
  ADD CONSTRAINT ck_erp_sales_invoices__notes CHECK (credited_amount >= 0 AND debited_amount >= 0),
  ADD CONSTRAINT ck_erp_sales_invoices__number CHECK (status::text = 'draft' OR invoice_no IS NOT NULL),
  ADD CONSTRAINT ck_erp_sales_invoices__due_date CHECK (due_date >= issue_date),
  ADD CONSTRAINT ck_erp_sales_invoices__void CHECK ((status::text = 'voided') = (void_reason IS NOT NULL)),
  ADD CONSTRAINT ck_erp_sales_invoices__tax CHECK (NOT is_tax_invoice OR vat_mode::text <> 'none');
ALTER TABLE erp_sales_invoice_lines
  ADD CONSTRAINT ck_erp_sales_invoice_lines__amounts CHECK (
    quantity > 0 AND unit_price >= 0 AND discount_pct >= 0 AND discount_pct <= 100 AND amount >= 0);

ALTER TABLE erp_sales_notes
  ADD CONSTRAINT ck_erp_sales_notes__amounts CHECK (
    original_value >= 0 AND correct_value >= 0 AND difference > 0 AND vat_amount >= 0 AND total = difference + vat_amount),
  ADD CONSTRAINT ck_erp_sales_notes__direction CHECK (
    (kind::text = 'credit' AND correct_value = original_value - difference)
    OR (kind::text = 'debit' AND correct_value = original_value + difference)),
  ADD CONSTRAINT ck_erp_sales_notes__number CHECK (status::text = 'draft' OR note_no IS NOT NULL),
  ADD CONSTRAINT ck_erp_sales_notes__void CHECK ((status::text = 'voided') = (void_reason IS NOT NULL));
ALTER TABLE erp_sales_note_lines
  ADD CONSTRAINT ck_erp_sales_note_lines__amount CHECK (amount > 0),
  ADD CONSTRAINT ck_erp_sales_note_lines__return CHECK (return_qty IS NULL OR (return_qty > 0 AND item_id IS NOT NULL));

ALTER TABLE erp_customer_receipts
  ADD CONSTRAINT ck_erp_customer_receipts__amounts CHECK (
    (kind::text = 'receipt' AND amount >= 0 AND wht_amount >= 0 AND amount + wht_amount > 0)
    OR (kind::text = 'refund' AND amount < 0 AND wht_amount = 0)),
  ADD CONSTRAINT ck_erp_customer_receipts__cancel CHECK ((status::text = 'cancelled') = (cancel_reason IS NOT NULL));
ALTER TABLE erp_receipt_allocations
  ADD CONSTRAINT ck_erp_receipt_allocations__amount CHECK (amount <> 0);
CREATE TRIGGER tg_erp_receipt_allocations__append_only BEFORE UPDATE OR DELETE ON erp_receipt_allocations
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE erp_billing_notes
  ADD CONSTRAINT ck_erp_billing_notes__total CHECK (total >= 0),
  ADD CONSTRAINT ck_erp_billing_notes__cancel CHECK ((status::text = 'cancelled') = (cancel_reason IS NOT NULL));
ALTER TABLE erp_billing_note_invoices
  ADD CONSTRAINT ck_erp_billing_note_invoices__amount CHECK (amount > 0);

ALTER TABLE erp_wht_certificates
  ADD CONSTRAINT ck_erp_wht_certificates__amounts CHECK (base_amount > 0 AND wht_amount >= 0 AND wht_amount <= base_amount),
  ADD CONSTRAINT ck_erp_wht_certificates__void CHECK ((status::text = 'voided') = (void_reason IS NOT NULL)),
  ADD CONSTRAINT ck_erp_wht_certificates__status CHECK (status::text <> 'draft');
-- One certificate in force per payment (D-366).
CREATE UNIQUE INDEX ux_erp_wht_certificates__payment_id__issued ON erp_wht_certificates (payment_id)
  WHERE status = 'issued';
ALTER TABLE erp_wht_certificate_lines
  ADD CONSTRAINT ck_erp_wht_certificate_lines__amounts CHECK (
    rate_pct >= 0 AND rate_pct <= 100 AND base_amount > 0 AND wht_amount >= 0 AND wht_amount <= base_amount);
CREATE TRIGGER tg_erp_wht_certificate_lines__append_only BEFORE UPDATE OR DELETE ON erp_wht_certificate_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE erp_sales_targets
  ADD CONSTRAINT ck_erp_sales_targets__amounts CHECK (target_net >= 0 AND commission_pct >= 0 AND commission_pct <= 100),
  ADD CONSTRAINT ck_erp_sales_targets__month CHECK (EXTRACT(DAY FROM month) = 1);
