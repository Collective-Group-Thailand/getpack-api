-- CreateEnum
CREATE TYPE "po_kind" AS ENUM ('production', 'mockup', 'reproduction');

-- CreateEnum
CREATE TYPE "po_status" AS ENUM ('issued', 'accepted', 'cancelled', 'received', 'closed');

-- CreateEnum
CREATE TYPE "po_line_type" AS ENUM ('production', 'shipping', 'mockup', 'design', 'reproduction');

-- CreateEnum
CREATE TYPE "billing_statement_status" AS ENUM ('generated', 'sent', 'confirmed', 'disputed', 'superseded');

-- CreateEnum
CREATE TYPE "vendor_invoice_source" AS ENUM ('e_tax', 'pdf_upload', 'manual');

-- CreateEnum
CREATE TYPE "input_vat_status" AS ENUM ('claimable', 'pending_document', 'not_claimable');

-- CreateEnum
CREATE TYPE "vendor_invoice_status" AS ENUM ('recorded', 'validated', 'rejected', 'void');

-- CreateEnum
CREATE TYPE "payable_source" AS ENUM ('advance', 'goods_receipt', 'vendor_invoice', 'retention');

-- CreateEnum
CREATE TYPE "payable_status" AS ENUM ('open', 'eligible', 'in_run', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "deduction_status" AS ENUM ('pending', 'applied', 'cancelled');

-- CreateEnum
CREATE TYPE "deduction_offset" AS ENUM ('payable', 'receivable');

-- CreateEnum
CREATE TYPE "payout_run_status" AS ENUM ('draft', 'proposed', 'approved', 'file_generated', 'confirmed', 'partially_failed', 'rejected', 'cancelled');

-- CreateEnum
CREATE TYPE "payout_kind" AS ENUM ('advance', 'balance', 'retention_release', 'vendor_bill');

-- CreateEnum
CREATE TYPE "payout_item_status" AS ENUM ('included', 'paid', 'failed', 'excluded');

-- CreateEnum
CREATE TYPE "wht_form" AS ENUM ('pnd3', 'pnd53');

-- CreateEnum
CREATE TYPE "issued_cert_status" AS ENUM ('issued', 'void');

-- CreateEnum
CREATE TYPE "bank_account_purpose" AS ENUM ('collection', 'payout', 'both');

-- CreateEnum
CREATE TYPE "statement_source" AS ENUM ('csv', 'api');

-- CreateEnum
CREATE TYPE "bank_match_status" AS ENUM ('unmatched', 'matched', 'unidentified', 'ignored');

-- CreateEnum
CREATE TYPE "bank_match_target" AS ENUM ('payment', 'gateway_settlement', 'payout_run', 'refund', 'unidentified_receipt', 'tax_payment');

-- CreateEnum
CREATE TYPE "settlement_status" AS ENUM ('imported', 'posted');

-- CreateEnum
CREATE TYPE "unidentified_status" AS ENUM ('open', 'matched', 'refunded');

-- CreateTable
CREATE TABLE "company_bank_accounts" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "bank_code" TEXT NOT NULL,
    "branch_name" TEXT,
    "account_name" TEXT NOT NULL,
    "account_no_enc" BYTEA NOT NULL,
    "account_no_last4" CHAR(4) NOT NULL,
    "account_no_hash" BYTEA NOT NULL,
    "gl_account_id" BIGINT NOT NULL,
    "purpose" "bank_account_purpose" NOT NULL,
    "default_bulk_format" TEXT NOT NULL DEFAULT 'generic_csv',
    "status" "bank_account_status" NOT NULL DEFAULT 'pending_approval',
    "approval_request_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_company_bank_accounts" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "po_number" TEXT NOT NULL,
    "po_kind" "po_kind" NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "factory_id" BIGINT NOT NULL,
    "production_job_id" BIGINT NOT NULL,
    "order_id" BIGINT NOT NULL,
    "status" "po_status" NOT NULL DEFAULT 'issued',
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ(6),
    "price_list_version_id" BIGINT,
    "price_snapshot" JSONB NOT NULL,
    "payout_policy_version_id" BIGINT,
    "payout_policy" JSONB NOT NULL,
    "is_vat_registered" BOOLEAN NOT NULL,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "vat_rate_pct" DECIMAL(7,4) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_purchase_orders" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "po_id" BIGINT NOT NULL,
    "line_no" SMALLINT NOT NULL,
    "line_type" "po_line_type" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(18,6) NOT NULL,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "wht_category" "wht_category" NOT NULL,

    CONSTRAINT "pk_purchase_order_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "gr_number" TEXT NOT NULL,
    "po_id" BIGINT NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "factory_id" BIGINT NOT NULL,
    "order_id" BIGINT NOT NULL,
    "received_quantity" INTEGER NOT NULL,
    "payable_quantity" INTEGER NOT NULL,
    "received_on" DATE NOT NULL,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_goods_receipts" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "gr_id" BIGINT NOT NULL,
    "line_no" SMALLINT NOT NULL,
    "line_type" "po_line_type" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(18,6) NOT NULL,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "wht_category" "wht_category" NOT NULL,
    "shipment_id" BIGINT,

    CONSTRAINT "pk_goods_receipt_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_statements" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "bs_number" TEXT NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "factory_id" BIGINT NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "status" "billing_statement_status" NOT NULL DEFAULT 'generated',
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_by_user_id" BIGINT,
    "confirmed_at" TIMESTAMPTZ(6),
    "dispute_note" TEXT,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "deduction_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_billing_statements" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_statement_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "statement_id" BIGINT NOT NULL,
    "line_no" SMALLINT NOT NULL,
    "goods_receipt_id" BIGINT,
    "vendor_deduction_id" BIGINT,
    "description" TEXT NOT NULL,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "pk_billing_statement_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_invoices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "billing_statement_id" BIGINT,
    "vendor_invoice_no" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "seller_tax_id" CHAR(13) NOT NULL,
    "seller_branch_code" CHAR(5) NOT NULL,
    "is_tax_invoice" BOOLEAN NOT NULL,
    "source" "vendor_invoice_source" NOT NULL,
    "file_object_id" BIGINT,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "input_vat_status" "input_vat_status" NOT NULL,
    "status" "vendor_invoice_status" NOT NULL DEFAULT 'recorded',
    "due_date" DATE,
    "order_id" BIGINT,
    "shipment_id" BIGINT,
    "validated_by" BIGINT,
    "validated_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "recorded_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_vendor_invoices" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_invoice_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "invoice_id" BIGINT NOT NULL,
    "line_no" SMALLINT NOT NULL,
    "description" TEXT NOT NULL,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "wht_category" "wht_category" NOT NULL,
    "account_id" BIGINT,

    CONSTRAINT "pk_vendor_invoice_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payable_items" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "source" "payable_source" NOT NULL,
    "purchase_order_id" BIGINT,
    "goods_receipt_id" BIGINT,
    "vendor_invoice_id" BIGINT,
    "order_id" BIGINT,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "open_net_amount" DECIMAL(14,2) NOT NULL,
    "open_vat_amount" DECIMAL(14,2) NOT NULL,
    "wht_base_hire" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "wht_base_transport" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "wht_base_service" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "retention_pct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "eligible_at" TIMESTAMPTZ(6),
    "status" "payable_status" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_payable_items" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_deductions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "factory_id" BIGINT,
    "claim_id" BIGINT,
    "amount" DECIMAL(14,2) NOT NULL,
    "offset_against" "deduction_offset" NOT NULL,
    "status" "deduction_status" NOT NULL DEFAULT 'applied',
    "vendor_credit_note_no" TEXT,
    "applied_payable_item_id" BIGINT,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_vendor_deductions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_runs" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "run_no" TEXT NOT NULL,
    "company_bank_account_id" BIGINT NOT NULL,
    "bank_format_adapter" TEXT NOT NULL,
    "pay_on" DATE NOT NULL,
    "status" "payout_run_status" NOT NULL DEFAULT 'draft',
    "proposed_by" BIGINT,
    "proposed_at" TIMESTAMPTZ(6),
    "approval_request_id" BIGINT,
    "approved_at" TIMESTAMPTZ(6),
    "bank_file_id" BIGINT,
    "bank_file_sha256" BYTEA,
    "confirmation_file_id" BIGINT,
    "confirmed_at" TIMESTAMPTZ(6),
    "ap_net_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "wht_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "retention_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cash_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_payout_runs" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_items" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "run_id" BIGINT NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "vendor_bank_account_id" BIGINT,
    "kind" "payout_kind" NOT NULL,
    "ap_net_amount" DECIMAL(14,2) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "vat_claimable" BOOLEAN NOT NULL,
    "wht_amount" DECIMAL(14,2) NOT NULL,
    "wht_base" DECIMAL(14,2) NOT NULL,
    "wht_form" "wht_form",
    "retention_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cash_amount" DECIMAL(14,2) NOT NULL,
    "pv_number" TEXT,
    "status" "payout_item_status" NOT NULL DEFAULT 'included',
    "bank_ref" TEXT,
    "failure_reason" TEXT,
    "paid_on" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_payout_items" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_item_allocations" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "payout_item_id" BIGINT NOT NULL,
    "payable_item_id" BIGINT NOT NULL,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "pk_payout_item_allocations" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wht_certificates" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "wt_number" TEXT NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "payout_item_id" BIGINT,
    "form" "wht_form" NOT NULL,
    "income_type_code" TEXT NOT NULL,
    "paid_on" DATE NOT NULL,
    "paid_amount" DECIMAL(14,2) NOT NULL,
    "wht_rate_pct" DECIMAL(7,4) NOT NULL,
    "wht_amount" DECIMAL(14,2) NOT NULL,
    "status" "issued_cert_status" NOT NULL DEFAULT 'issued',
    "file_object_id" BIGINT,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_wht_certificates" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_imports" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "company_bank_account_id" BIGINT NOT NULL,
    "source" "statement_source" NOT NULL,
    "file_object_id" BIGINT,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "file_sha256" BYTEA NOT NULL,
    "line_count" INTEGER NOT NULL,
    "imported_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_bank_statement_imports" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "import_id" BIGINT NOT NULL,
    "company_bank_account_id" BIGINT NOT NULL,
    "txn_date" DATE NOT NULL,
    "value_date" DATE,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "counterparty" TEXT,
    "running_balance" DECIMAL(14,2),
    "dedupe_hash" BYTEA NOT NULL,
    "match_status" "bank_match_status" NOT NULL DEFAULT 'unmatched',
    "matched_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_bank_statement_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_matches" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "statement_line_id" BIGINT NOT NULL,
    "target_type" "bank_match_target" NOT NULL,
    "target_public_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "auto" BOOLEAN NOT NULL,
    "matched_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_bank_matches" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_settlements" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "provider" "payment_provider" NOT NULL,
    "settlement_date" DATE NOT NULL,
    "company_bank_account_id" BIGINT NOT NULL,
    "report_file_id" BIGINT,
    "report_sha256" BYTEA NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "fee_amount" DECIMAL(14,2) NOT NULL,
    "vat_on_fee" DECIMAL(14,2) NOT NULL,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "fee_tax_invoice_no" TEXT,
    "status" "settlement_status" NOT NULL DEFAULT 'imported',
    "statement_line_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,

    CONSTRAINT "pk_gateway_settlements" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_settlement_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "settlement_id" BIGINT NOT NULL,
    "payment_id" BIGINT,
    "provider_ref" TEXT NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "fee_amount" DECIMAL(14,2) NOT NULL,
    "net_amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "pk_gateway_settlement_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unidentified_receipts" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "statement_line_id" BIGINT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "unidentified_status" NOT NULL DEFAULT 'open',
    "matched_payment_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_unidentified_receipts" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_company_bank_accounts__public_id" ON "company_bank_accounts"("public_id");

-- CreateIndex
CREATE INDEX "ix_company_bank_accounts__entity_id" ON "company_bank_accounts"("entity_id");

-- CreateIndex
CREATE INDEX "ix_company_bank_accounts__account_no_hash" ON "company_bank_accounts"("account_no_hash");

-- CreateIndex
CREATE INDEX "ix_company_bank_accounts__approval_request_id" ON "company_bank_accounts"("approval_request_id");

-- CreateIndex
CREATE INDEX "ix_company_bank_accounts__created_by" ON "company_bank_accounts"("created_by");

-- CreateIndex
CREATE INDEX "ix_company_bank_accounts__gl_account" ON "company_bank_accounts"("gl_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_company_bank_accounts__gl_account_id" ON "company_bank_accounts"("gl_account_id") WHERE (status = 'active'::bank_account_status);

-- CreateIndex
CREATE UNIQUE INDEX "ux_purchase_orders__public_id" ON "purchase_orders"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_purchase_orders__production_job_id" ON "purchase_orders"("production_job_id");

-- CreateIndex
CREATE INDEX "ix_purchase_orders__vendor_id" ON "purchase_orders"("vendor_id");

-- CreateIndex
CREATE INDEX "ix_purchase_orders__factory_id__issued_at" ON "purchase_orders"("factory_id", "issued_at");

-- CreateIndex
CREATE INDEX "ix_purchase_orders__order_id" ON "purchase_orders"("order_id");

-- CreateIndex
CREATE INDEX "ix_purchase_orders__price_list_version_id" ON "purchase_orders"("price_list_version_id");

-- CreateIndex
CREATE INDEX "ix_purchase_orders__payout_policy_version_id" ON "purchase_orders"("payout_policy_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_purchase_orders__entity_id__po_number" ON "purchase_orders"("entity_id", "po_number");

-- CreateIndex
CREATE UNIQUE INDEX "ux_purchase_order_lines__po_id__line_no" ON "purchase_order_lines"("po_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_goods_receipts__public_id" ON "goods_receipts"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_goods_receipts__po_id" ON "goods_receipts"("po_id");

-- CreateIndex
CREATE INDEX "ix_goods_receipts__vendor_id" ON "goods_receipts"("vendor_id");

-- CreateIndex
CREATE INDEX "ix_goods_receipts__factory_id" ON "goods_receipts"("factory_id");

-- CreateIndex
CREATE INDEX "ix_goods_receipts__order_id" ON "goods_receipts"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_goods_receipts__entity_id__gr_number" ON "goods_receipts"("entity_id", "gr_number");

-- CreateIndex
CREATE INDEX "ix_goods_receipt_lines__shipment_id" ON "goods_receipt_lines"("shipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_goods_receipt_lines__gr_id__line_no" ON "goods_receipt_lines"("gr_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_billing_statements__public_id" ON "billing_statements"("public_id");

-- CreateIndex
CREATE INDEX "ix_billing_statements__factory_id__status" ON "billing_statements"("factory_id", "status");

-- CreateIndex
CREATE INDEX "ix_billing_statements__vendor_id" ON "billing_statements"("vendor_id");

-- CreateIndex
CREATE INDEX "ix_billing_statements__confirmed_by_user_id" ON "billing_statements"("confirmed_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_billing_statements__entity_id__bs_number" ON "billing_statements"("entity_id", "bs_number");

-- CreateIndex
CREATE INDEX "ix_billing_statement_lines__goods_receipt_id" ON "billing_statement_lines"("goods_receipt_id");

-- CreateIndex
CREATE INDEX "ix_billing_statement_lines__vendor_deduction_id" ON "billing_statement_lines"("vendor_deduction_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_billing_statement_lines__statement_id__line_no" ON "billing_statement_lines"("statement_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_vendor_invoices__public_id" ON "vendor_invoices"("public_id");

-- CreateIndex
CREATE INDEX "ix_vendor_invoices__billing_statement_id" ON "vendor_invoices"("billing_statement_id");

-- CreateIndex
CREATE INDEX "ix_vendor_invoices__entity_id__invoice_date" ON "vendor_invoices"("entity_id", "invoice_date");

-- CreateIndex
CREATE INDEX "ix_vendor_invoices__file_object_id" ON "vendor_invoices"("file_object_id");

-- CreateIndex
CREATE INDEX "ix_vendor_invoices__order_id" ON "vendor_invoices"("order_id");

-- CreateIndex
CREATE INDEX "ix_vendor_invoices__shipment_id" ON "vendor_invoices"("shipment_id");

-- CreateIndex
CREATE INDEX "ix_vendor_invoices__validated_by" ON "vendor_invoices"("validated_by");

-- CreateIndex
CREATE INDEX "ix_vendor_invoices__recorded_by" ON "vendor_invoices"("recorded_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_vendor_invoices__vendor_id__vendor_invoice_no" ON "vendor_invoices"("vendor_id", "vendor_invoice_no");

-- CreateIndex
CREATE INDEX "ix_vendor_invoice_lines__account_id" ON "vendor_invoice_lines"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_vendor_invoice_lines__invoice_id__line_no" ON "vendor_invoice_lines"("invoice_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_payable_items__public_id" ON "payable_items"("public_id");

-- CreateIndex
CREATE INDEX "ix_payable_items__vendor_id__status__eligible_at" ON "payable_items"("vendor_id", "status", "eligible_at");

-- CreateIndex
CREATE INDEX "ix_payable_items__purchase_order_id" ON "payable_items"("purchase_order_id");

-- CreateIndex
CREATE INDEX "ix_payable_items__goods_receipt_id" ON "payable_items"("goods_receipt_id");

-- CreateIndex
CREATE INDEX "ix_payable_items__vendor_invoice_id" ON "payable_items"("vendor_invoice_id");

-- CreateIndex
CREATE INDEX "ix_payable_items__order_id" ON "payable_items"("order_id");

-- CreateIndex
CREATE INDEX "ix_payable_items__entity_id__status" ON "payable_items"("entity_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ux_vendor_deductions__public_id" ON "vendor_deductions"("public_id");

-- CreateIndex
CREATE INDEX "ix_vendor_deductions__vendor_id" ON "vendor_deductions"("vendor_id");

-- CreateIndex
CREATE INDEX "ix_vendor_deductions__factory_id" ON "vendor_deductions"("factory_id");

-- CreateIndex
CREATE INDEX "ix_vendor_deductions__claim_id" ON "vendor_deductions"("claim_id");

-- CreateIndex
CREATE INDEX "ix_vendor_deductions__applied_payable_item_id" ON "vendor_deductions"("applied_payable_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_payout_runs__public_id" ON "payout_runs"("public_id");

-- CreateIndex
CREATE INDEX "ix_payout_runs__status" ON "payout_runs"("status");

-- CreateIndex
CREATE INDEX "ix_payout_runs__company_bank_account_id" ON "payout_runs"("company_bank_account_id");

-- CreateIndex
CREATE INDEX "ix_payout_runs__proposed_by" ON "payout_runs"("proposed_by");

-- CreateIndex
CREATE INDEX "ix_payout_runs__created_by" ON "payout_runs"("created_by");

-- CreateIndex
CREATE INDEX "ix_payout_runs__approval_request_id" ON "payout_runs"("approval_request_id");

-- CreateIndex
CREATE INDEX "ix_payout_runs__bank_file_id" ON "payout_runs"("bank_file_id");

-- CreateIndex
CREATE INDEX "ix_payout_runs__confirmation_file_id" ON "payout_runs"("confirmation_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_payout_runs__entity_id__run_no" ON "payout_runs"("entity_id", "run_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_payout_items__public_id" ON "payout_items"("public_id");

-- CreateIndex
CREATE INDEX "ix_payout_items__run_id" ON "payout_items"("run_id");

-- CreateIndex
CREATE INDEX "ix_payout_items__vendor_id__status" ON "payout_items"("vendor_id", "status");

-- CreateIndex
CREATE INDEX "ix_payout_items__vendor_bank_account_id" ON "payout_items"("vendor_bank_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_payout_items__pv_number" ON "payout_items"("pv_number") WHERE (pv_number IS NOT NULL);

-- CreateIndex
CREATE INDEX "ix_payout_item_allocations__payable_item_id" ON "payout_item_allocations"("payable_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_payout_item_allocations__item__payable" ON "payout_item_allocations"("payout_item_id", "payable_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_wht_certificates__public_id" ON "wht_certificates"("public_id");

-- CreateIndex
CREATE INDEX "ix_wht_certificates__vendor_id__paid_on" ON "wht_certificates"("vendor_id", "paid_on");

-- CreateIndex
CREATE INDEX "ix_wht_certificates__payout_item_id" ON "wht_certificates"("payout_item_id");

-- CreateIndex
CREATE INDEX "ix_wht_certificates__file_object_id" ON "wht_certificates"("file_object_id");

-- CreateIndex
CREATE INDEX "ix_wht_certificates__entity_id__form__paid_on" ON "wht_certificates"("entity_id", "form", "paid_on");

-- CreateIndex
CREATE UNIQUE INDEX "ux_wht_certificates__entity_id__wt_number" ON "wht_certificates"("entity_id", "wt_number");

-- CreateIndex
CREATE UNIQUE INDEX "ux_bank_statement_imports__public_id" ON "bank_statement_imports"("public_id");

-- CreateIndex
CREATE INDEX "ix_bank_statement_imports__company_bank_account_id" ON "bank_statement_imports"("company_bank_account_id");

-- CreateIndex
CREATE INDEX "ix_bank_statement_imports__entity_id" ON "bank_statement_imports"("entity_id");

-- CreateIndex
CREATE INDEX "ix_bank_statement_imports__file_object_id" ON "bank_statement_imports"("file_object_id");

-- CreateIndex
CREATE INDEX "ix_bank_statement_imports__imported_by" ON "bank_statement_imports"("imported_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_bank_statement_imports__file_sha256" ON "bank_statement_imports"("file_sha256");

-- CreateIndex
CREATE UNIQUE INDEX "ux_bank_statement_lines__public_id" ON "bank_statement_lines"("public_id");

-- CreateIndex
CREATE INDEX "ix_bank_statement_lines__import_id" ON "bank_statement_lines"("import_id");

-- CreateIndex
CREATE INDEX "ix_bank_statement_lines__account__status__txn_date" ON "bank_statement_lines"("company_bank_account_id", "match_status", "txn_date");

-- CreateIndex
CREATE UNIQUE INDEX "ux_bank_statement_lines__account__dedupe_hash" ON "bank_statement_lines"("company_bank_account_id", "dedupe_hash");

-- CreateIndex
CREATE INDEX "ix_bank_matches__statement_line_id" ON "bank_matches"("statement_line_id");

-- CreateIndex
CREATE INDEX "ix_bank_matches__matched_by" ON "bank_matches"("matched_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_bank_matches__target" ON "bank_matches"("target_type", "target_public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_gateway_settlements__public_id" ON "gateway_settlements"("public_id");

-- CreateIndex
CREATE INDEX "ix_gateway_settlements__entity_id__settlement_date" ON "gateway_settlements"("entity_id", "settlement_date");

-- CreateIndex
CREATE INDEX "ix_gateway_settlements__company_bank_account_id" ON "gateway_settlements"("company_bank_account_id");

-- CreateIndex
CREATE INDEX "ix_gateway_settlements__report_file_id" ON "gateway_settlements"("report_file_id");

-- CreateIndex
CREATE INDEX "ix_gateway_settlements__statement_line_id" ON "gateway_settlements"("statement_line_id");

-- CreateIndex
CREATE INDEX "ix_gateway_settlements__created_by" ON "gateway_settlements"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_gateway_settlements__report_sha256" ON "gateway_settlements"("report_sha256");

-- CreateIndex
CREATE INDEX "ix_gateway_settlement_lines__settlement_id" ON "gateway_settlement_lines"("settlement_id");

-- CreateIndex
CREATE INDEX "ix_gateway_settlement_lines__payment_id" ON "gateway_settlement_lines"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_unidentified_receipts__public_id" ON "unidentified_receipts"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_unidentified_receipts__statement_line_id" ON "unidentified_receipts"("statement_line_id");

-- CreateIndex
CREATE INDEX "ix_unidentified_receipts__entity_id__status" ON "unidentified_receipts"("entity_id", "status");

-- CreateIndex
CREATE INDEX "ix_unidentified_receipts__matched_payment_id" ON "unidentified_receipts"("matched_payment_id");

-- AddForeignKey
ALTER TABLE "company_bank_accounts" ADD CONSTRAINT "fk_company_bank_accounts__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_bank_accounts" ADD CONSTRAINT "fk_company_bank_accounts__gl_account_id" FOREIGN KEY ("gl_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_bank_accounts" ADD CONSTRAINT "fk_company_bank_accounts__approval_request_id" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_bank_accounts" ADD CONSTRAINT "fk_company_bank_accounts__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "fk_purchase_orders__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "fk_purchase_orders__vendor_id" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "fk_purchase_orders__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "fk_purchase_orders__production_job_id" FOREIGN KEY ("production_job_id") REFERENCES "production_jobs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "fk_purchase_orders__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "fk_purchase_orders__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "fk_purchase_orders__payout_policy_version_id" FOREIGN KEY ("payout_policy_version_id") REFERENCES "factory_payout_policy_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "fk_purchase_order_lines__po_id" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "fk_goods_receipts__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "fk_goods_receipts__po_id" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "fk_goods_receipts__vendor_id" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "fk_goods_receipts__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "fk_goods_receipts__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "fk_goods_receipt_lines__gr_id" FOREIGN KEY ("gr_id") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "fk_goods_receipt_lines__shipment_id" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "billing_statements" ADD CONSTRAINT "fk_billing_statements__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "billing_statements" ADD CONSTRAINT "fk_billing_statements__vendor_id" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "billing_statements" ADD CONSTRAINT "fk_billing_statements__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "billing_statements" ADD CONSTRAINT "fk_billing_statements__confirmed_by_user_id" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "billing_statement_lines" ADD CONSTRAINT "fk_billing_statement_lines__statement_id" FOREIGN KEY ("statement_id") REFERENCES "billing_statements"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "billing_statement_lines" ADD CONSTRAINT "fk_billing_statement_lines__goods_receipt_id" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "billing_statement_lines" ADD CONSTRAINT "fk_billing_statement_lines__vendor_deduction_id" FOREIGN KEY ("vendor_deduction_id") REFERENCES "vendor_deductions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "fk_vendor_invoices__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "fk_vendor_invoices__vendor_id" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "fk_vendor_invoices__billing_statement_id" FOREIGN KEY ("billing_statement_id") REFERENCES "billing_statements"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "fk_vendor_invoices__file_object_id" FOREIGN KEY ("file_object_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "fk_vendor_invoices__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "fk_vendor_invoices__shipment_id" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "fk_vendor_invoices__validated_by" FOREIGN KEY ("validated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "fk_vendor_invoices__recorded_by" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vendor_invoice_lines" ADD CONSTRAINT "fk_vendor_invoice_lines__invoice_id" FOREIGN KEY ("invoice_id") REFERENCES "vendor_invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vendor_invoice_lines" ADD CONSTRAINT "fk_vendor_invoice_lines__account_id" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payable_items" ADD CONSTRAINT "fk_payable_items__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payable_items" ADD CONSTRAINT "fk_payable_items__vendor_id" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payable_items" ADD CONSTRAINT "fk_payable_items__purchase_order_id" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payable_items" ADD CONSTRAINT "fk_payable_items__goods_receipt_id" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payable_items" ADD CONSTRAINT "fk_payable_items__vendor_invoice_id" FOREIGN KEY ("vendor_invoice_id") REFERENCES "vendor_invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payable_items" ADD CONSTRAINT "fk_payable_items__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vendor_deductions" ADD CONSTRAINT "fk_vendor_deductions__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vendor_deductions" ADD CONSTRAINT "fk_vendor_deductions__vendor_id" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vendor_deductions" ADD CONSTRAINT "fk_vendor_deductions__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vendor_deductions" ADD CONSTRAINT "fk_vendor_deductions__claim_id" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vendor_deductions" ADD CONSTRAINT "fk_vendor_deductions__applied_payable_item_id" FOREIGN KEY ("applied_payable_item_id") REFERENCES "payable_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payout_runs" ADD CONSTRAINT "fk_payout_runs__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payout_runs" ADD CONSTRAINT "fk_payout_runs__company_bank_account_id" FOREIGN KEY ("company_bank_account_id") REFERENCES "company_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payout_runs" ADD CONSTRAINT "fk_payout_runs__proposed_by" FOREIGN KEY ("proposed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payout_runs" ADD CONSTRAINT "fk_payout_runs__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payout_runs" ADD CONSTRAINT "fk_payout_runs__approval_request_id" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payout_runs" ADD CONSTRAINT "fk_payout_runs__bank_file_id" FOREIGN KEY ("bank_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payout_runs" ADD CONSTRAINT "fk_payout_runs__confirmation_file_id" FOREIGN KEY ("confirmation_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payout_items" ADD CONSTRAINT "fk_payout_items__run_id" FOREIGN KEY ("run_id") REFERENCES "payout_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payout_items" ADD CONSTRAINT "fk_payout_items__vendor_id" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payout_items" ADD CONSTRAINT "fk_payout_items__vendor_bank_account_id" FOREIGN KEY ("vendor_bank_account_id") REFERENCES "vendor_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payout_item_allocations" ADD CONSTRAINT "fk_payout_item_allocations__payout_item_id" FOREIGN KEY ("payout_item_id") REFERENCES "payout_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payout_item_allocations" ADD CONSTRAINT "fk_payout_item_allocations__payable_item_id" FOREIGN KEY ("payable_item_id") REFERENCES "payable_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "wht_certificates" ADD CONSTRAINT "fk_wht_certificates__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "wht_certificates" ADD CONSTRAINT "fk_wht_certificates__vendor_id" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "wht_certificates" ADD CONSTRAINT "fk_wht_certificates__payout_item_id" FOREIGN KEY ("payout_item_id") REFERENCES "payout_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "wht_certificates" ADD CONSTRAINT "fk_wht_certificates__file_object_id" FOREIGN KEY ("file_object_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "fk_bank_statement_imports__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "fk_bank_statement_imports__company_bank_account_id" FOREIGN KEY ("company_bank_account_id") REFERENCES "company_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "fk_bank_statement_imports__file_object_id" FOREIGN KEY ("file_object_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "fk_bank_statement_imports__imported_by" FOREIGN KEY ("imported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "fk_bank_statement_lines__import_id" FOREIGN KEY ("import_id") REFERENCES "bank_statement_imports"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "fk_bank_statement_lines__company_bank_account_id" FOREIGN KEY ("company_bank_account_id") REFERENCES "company_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "bank_matches" ADD CONSTRAINT "fk_bank_matches__statement_line_id" FOREIGN KEY ("statement_line_id") REFERENCES "bank_statement_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "bank_matches" ADD CONSTRAINT "fk_bank_matches__matched_by" FOREIGN KEY ("matched_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "gateway_settlements" ADD CONSTRAINT "fk_gateway_settlements__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "gateway_settlements" ADD CONSTRAINT "fk_gateway_settlements__company_bank_account_id" FOREIGN KEY ("company_bank_account_id") REFERENCES "company_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "gateway_settlements" ADD CONSTRAINT "fk_gateway_settlements__report_file_id" FOREIGN KEY ("report_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "gateway_settlements" ADD CONSTRAINT "fk_gateway_settlements__statement_line_id" FOREIGN KEY ("statement_line_id") REFERENCES "bank_statement_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "gateway_settlements" ADD CONSTRAINT "fk_gateway_settlements__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "gateway_settlement_lines" ADD CONSTRAINT "fk_gateway_settlement_lines__settlement_id" FOREIGN KEY ("settlement_id") REFERENCES "gateway_settlements"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "gateway_settlement_lines" ADD CONSTRAINT "fk_gateway_settlement_lines__payment_id" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "unidentified_receipts" ADD CONSTRAINT "fk_unidentified_receipts__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "unidentified_receipts" ADD CONSTRAINT "fk_unidentified_receipts__statement_line_id" FOREIGN KEY ("statement_line_id") REFERENCES "bank_statement_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "unidentified_receipts" ADD CONSTRAINT "fk_unidentified_receipts__matched_payment_id" FOREIGN KEY ("matched_payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "claim_resolutions" ADD CONSTRAINT "fk_claim_resolutions__vendor_deduction_id" FOREIGN KEY ("vendor_deduction_id") REFERENCES "vendor_deductions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- =====================================================================================================
-- Hand-written: payables, payouts & banking (accounting-design §2, §6, §8; schema-design §3.8, A-43)
-- =====================================================================================================

ALTER TABLE company_bank_accounts
  ADD CONSTRAINT ck_company_bank_accounts__last4 CHECK (account_no_last4 ~ '^[0-9]{4}$'),
  ADD CONSTRAINT ck_company_bank_accounts__name CHECK (btrim(account_name) <> '');
-- A change is a new row; the approved row is never edited (dual approval, §8).
CREATE FUNCTION tg_company_bank_accounts__frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'company bank accounts are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'decided_at' - 'approval_request_id') <> (to_jsonb(OLD) - 'status' - 'decided_at' - 'approval_request_id') THEN
    RAISE EXCEPTION 'company bank account % cannot be edited: propose a new one', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_company_bank_accounts__frozen BEFORE UPDATE OR DELETE ON company_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION tg_company_bank_accounts__frozen();

ALTER TABLE purchase_orders
  ADD CONSTRAINT ck_purchase_orders__amounts CHECK (net_amount >= 0 AND vat_amount >= 0 AND gross_amount = net_amount + vat_amount),
  ADD CONSTRAINT ck_purchase_orders__accepted CHECK (status NOT IN ('accepted', 'received', 'closed') OR accepted_at IS NOT NULL OR po_kind <> 'production');
CREATE FUNCTION tg_purchase_orders__snapshot_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'purchase orders are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'accepted_at') <> (to_jsonb(OLD) - 'status' - 'accepted_at') THEN
    RAISE EXCEPTION 'purchase order % keeps its price snapshot', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_purchase_orders__snapshot_frozen BEFORE UPDATE OR DELETE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION tg_purchase_orders__snapshot_frozen();
ALTER TABLE purchase_order_lines
  ADD CONSTRAINT ck_purchase_order_lines__amounts CHECK (quantity >= 0 AND net_amount >= 0 AND vat_amount >= 0 AND gross_amount = net_amount + vat_amount);
CREATE TRIGGER tg_purchase_order_lines__append_only BEFORE UPDATE OR DELETE ON purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE goods_receipts
  ADD CONSTRAINT ck_goods_receipts__quantities CHECK (payable_quantity >= 0 AND received_quantity >= 0),
  ADD CONSTRAINT ck_goods_receipts__amounts CHECK (net_amount >= 0 AND vat_amount >= 0 AND gross_amount = net_amount + vat_amount);
CREATE TRIGGER tg_goods_receipts__append_only BEFORE UPDATE OR DELETE ON goods_receipts
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
ALTER TABLE goods_receipt_lines
  ADD CONSTRAINT ck_goods_receipt_lines__amounts CHECK (quantity >= 0 AND net_amount >= 0 AND vat_amount >= 0 AND gross_amount = net_amount + vat_amount);
CREATE TRIGGER tg_goods_receipt_lines__append_only BEFORE UPDATE OR DELETE ON goods_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE billing_statements
  ADD CONSTRAINT ck_billing_statements__period CHECK (period_to >= period_from),
  ADD CONSTRAINT ck_billing_statements__confirmed CHECK (status <> 'confirmed' OR (confirmed_at IS NOT NULL AND confirmed_by_user_id IS NOT NULL)),
  ADD CONSTRAINT ck_billing_statements__disputed CHECK (status <> 'disputed' OR btrim(coalesce(dispute_note, '')) <> '');
CREATE TRIGGER tg_billing_statements__no_delete BEFORE DELETE ON billing_statements
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();
CREATE TRIGGER tg_billing_statement_lines__append_only BEFORE UPDATE OR DELETE ON billing_statement_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE vendor_invoices
  ADD CONSTRAINT ck_vendor_invoices__no CHECK (btrim(vendor_invoice_no) <> ''),
  ADD CONSTRAINT ck_vendor_invoices__tax_id CHECK (seller_tax_id ~ '^[0-9]{13}$' AND seller_branch_code ~ '^[0-9]{5}$'),
  ADD CONSTRAINT ck_vendor_invoices__amounts CHECK (net_amount >= 0 AND vat_amount >= 0 AND gross_amount = net_amount + vat_amount),
  -- Input VAT only with a valid tax invoice (§2).
  ADD CONSTRAINT ck_vendor_invoices__claimable CHECK (input_vat_status <> 'claimable' OR (is_tax_invoice AND status = 'validated')),
  ADD CONSTRAINT ck_vendor_invoices__rejected CHECK (status <> 'rejected' OR btrim(coalesce(rejection_reason, '')) <> '');
CREATE TRIGGER tg_vendor_invoices__no_delete BEFORE DELETE ON vendor_invoices
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();
ALTER TABLE vendor_invoice_lines
  ADD CONSTRAINT ck_vendor_invoice_lines__amounts CHECK (net_amount >= 0 AND vat_amount >= 0 AND gross_amount = net_amount + vat_amount);
CREATE TRIGGER tg_vendor_invoice_lines__append_only BEFORE UPDATE OR DELETE ON vendor_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE payable_items
  ADD CONSTRAINT ck_payable_items__amounts CHECK (
    net_amount >= 0 AND vat_amount >= 0 AND open_net_amount >= 0 AND open_net_amount <= net_amount
    AND open_vat_amount >= 0 AND open_vat_amount <= vat_amount
    AND wht_base_hire >= 0 AND wht_base_transport >= 0 AND wht_base_service >= 0),
  ADD CONSTRAINT ck_payable_items__source CHECK (
    (source = 'vendor_invoice') = (vendor_invoice_id IS NOT NULL)
    AND (source <> 'goods_receipt' OR goods_receipt_id IS NOT NULL)
    AND (source <> 'advance' OR purchase_order_id IS NOT NULL)),
  ADD CONSTRAINT ck_payable_items__paid CHECK (status <> 'paid' OR (open_net_amount = 0 AND open_vat_amount = 0)),
  ADD CONSTRAINT ck_payable_items__retention CHECK (retention_pct >= 0 AND retention_pct <= 100);
CREATE TRIGGER tg_payable_items__no_delete BEFORE DELETE ON payable_items
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE vendor_deductions ADD CONSTRAINT ck_vendor_deductions__amount CHECK (amount > 0);
CREATE TRIGGER tg_vendor_deductions__no_delete BEFORE DELETE ON vendor_deductions
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE payout_runs
  ADD CONSTRAINT ck_payout_runs__proposed CHECK (status IN ('draft', 'cancelled') OR (proposed_at IS NOT NULL AND proposed_by IS NOT NULL)),
  ADD CONSTRAINT ck_payout_runs__approved CHECK (status NOT IN ('approved', 'file_generated', 'confirmed', 'partially_failed') OR approved_at IS NOT NULL),
  ADD CONSTRAINT ck_payout_runs__file CHECK ((bank_file_id IS NULL) = (bank_file_sha256 IS NULL)),
  ADD CONSTRAINT ck_payout_runs__amounts CHECK (ap_net_amount >= 0 AND vat_amount >= 0 AND wht_amount >= 0 AND retention_amount >= 0 AND cash_amount >= 0);
CREATE TRIGGER tg_payout_runs__no_delete BEFORE DELETE ON payout_runs
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE payout_items
  ADD CONSTRAINT ck_payout_items__cash CHECK (cash_amount >= 0 AND cash_amount = ap_net_amount + vat_amount - wht_amount - retention_amount),
  ADD CONSTRAINT ck_payout_items__wht CHECK ((wht_amount = 0) OR (wht_form IS NOT NULL AND wht_base > 0)),
  ADD CONSTRAINT ck_payout_items__paid CHECK (status <> 'paid' OR (paid_on IS NOT NULL AND pv_number IS NOT NULL)),
  ADD CONSTRAINT ck_payout_items__failed CHECK (status <> 'failed' OR btrim(coalesce(failure_reason, '')) <> '');
-- Paid items never change (posted, P14 / P17 / P18 / P25P).
CREATE FUNCTION tg_payout_items__paid_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payout items are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'paid' THEN
    RAISE EXCEPTION 'payout item % is paid and cannot change', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_payout_items__paid_frozen BEFORE UPDATE OR DELETE ON payout_items
  FOR EACH ROW EXECUTE FUNCTION tg_payout_items__paid_frozen();
ALTER TABLE payout_item_allocations ADD CONSTRAINT ck_payout_item_allocations__amounts CHECK (net_amount >= 0 AND vat_amount >= 0);
CREATE TRIGGER tg_payout_item_allocations__append_only BEFORE UPDATE OR DELETE ON payout_item_allocations
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE wht_certificates
  ADD CONSTRAINT ck_wht_certificates__amounts CHECK (wht_amount > 0 AND paid_amount >= wht_amount AND wht_rate_pct > 0),
  ADD CONSTRAINT ck_wht_certificates__void CHECK (status <> 'void' OR btrim(coalesce(void_reason, '')) <> '');
CREATE TRIGGER tg_wht_certificates__no_delete BEFORE DELETE ON wht_certificates
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE bank_statement_imports
  ADD CONSTRAINT ck_bank_statement_imports__period CHECK (period_to >= period_from),
  ADD CONSTRAINT ck_bank_statement_imports__lines CHECK (line_count >= 0);
CREATE TRIGGER tg_bank_statement_imports__append_only BEFORE UPDATE OR DELETE ON bank_statement_imports
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
ALTER TABLE bank_statement_lines ADD CONSTRAINT ck_bank_statement_lines__amount CHECK (amount <> 0);
-- A statement line keeps what the bank said; only its match state moves.
CREATE FUNCTION tg_bank_statement_lines__frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bank statement lines are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'match_status' - 'matched_at') <> (to_jsonb(OLD) - 'match_status' - 'matched_at') THEN
    RAISE EXCEPTION 'bank statement line % cannot change', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_bank_statement_lines__frozen BEFORE UPDATE OR DELETE ON bank_statement_lines
  FOR EACH ROW EXECUTE FUNCTION tg_bank_statement_lines__frozen();
ALTER TABLE bank_matches ADD CONSTRAINT ck_bank_matches__amount CHECK (amount <> 0);
CREATE TRIGGER tg_bank_matches__append_only BEFORE UPDATE OR DELETE ON bank_matches
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE gateway_settlements
  ADD CONSTRAINT ck_gateway_settlements__amounts CHECK (
    gross_amount >= 0 AND fee_amount >= 0 AND vat_on_fee >= 0 AND net_amount = gross_amount - fee_amount - vat_on_fee),
  ADD CONSTRAINT ck_gateway_settlements__provider CHECK (provider IN ('scb', 'twoc2p'));
CREATE TRIGGER tg_gateway_settlements__no_delete BEFORE DELETE ON gateway_settlements
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();
CREATE TRIGGER tg_gateway_settlement_lines__append_only BEFORE UPDATE OR DELETE ON gateway_settlement_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE unidentified_receipts
  ADD CONSTRAINT ck_unidentified_receipts__amount CHECK (amount > 0),
  ADD CONSTRAINT ck_unidentified_receipts__matched CHECK ((status = 'matched') = (matched_payment_id IS NOT NULL));
