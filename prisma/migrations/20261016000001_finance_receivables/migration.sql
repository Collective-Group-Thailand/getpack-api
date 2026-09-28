-- CreateEnum
CREATE TYPE "customer_document_status" AS ENUM ('issued', 'void');

-- CreateEnum
CREATE TYPE "customer_document_kind" AS ENUM ('instalment', 'final', 'delivery', 'collection', 'credit_note', 'debit_note');

-- CreateEnum
CREATE TYPE "receipt_via" AS ENUM ('scb', 'twoc2p', 'slip', 'bank', 'unidentified', 'store_credit');

-- CreateEnum
CREATE TYPE "etax_status" AS ENUM ('not_applicable', 'pending', 'submitted', 'accepted', 'rejected');

-- CreateEnum
CREATE TYPE "document_link_kind" AS ENUM ('deducts_instalment', 'credits', 'debits', 'replaces', 'receipt_for');

-- CreateEnum
CREATE TYPE "cn_statutory_category" AS ENUM ('price_reduction', 'defective_or_short', 'returns', 'cancellation', 'post_sale_discount', 'other');

-- CreateEnum
CREATE TYPE "cn_applies_to" AS ENUM ('item', 'service', 'both');

-- CreateEnum
CREATE TYPE "credit_note_kind" AS ENUM ('shortage', 'claim', 'cancellation', 'price_reduction', 'return', 'discount');

-- CreateEnum
CREATE TYPE "credit_settlement" AS ENUM ('store_credit', 'receivable');

-- CreateEnum
CREATE TYPE "credit_note_request_status" AS ENUM ('pending_approval', 'issued', 'rejected', 'withdrawn');

-- CreateEnum
CREATE TYPE "wht_cert_status" AS ENUM ('pending', 'received', 'waived');

-- CreateEnum
CREATE TYPE "ar_item_status" AS ENUM ('open', 'partially_paid', 'paid', 'written_off', 'cancelled');

-- CreateEnum
CREATE TYPE "dunning_stage" AS ENUM ('before_due', 'on_due', 'overdue');

-- CreateEnum
CREATE TYPE "store_credit_source" AS ENUM ('shortage_credit', 'cancellation', 'claim', 'refund_alternative', 'applied_to_order', 'manual', 'refunded');

-- CreateTable
CREATE TABLE "customer_documents" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "doc_type" "document_type" NOT NULL,
    "doc_kind" "customer_document_kind" NOT NULL,
    "doc_number" TEXT NOT NULL,
    "status" "customer_document_status" NOT NULL DEFAULT 'issued',
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "document_date" DATE NOT NULL,
    "tax_point_date" DATE,
    "is_tax_invoice" BOOLEAN NOT NULL,
    "is_full_form" BOOLEAN NOT NULL DEFAULT false,
    "customer_user_id" BIGINT NOT NULL,
    "company_id" BIGINT,
    "company_branch_id" BIGINT,
    "buyer_snapshot" JSONB NOT NULL,
    "seller_snapshot" JSONB NOT NULL,
    "order_group_id" BIGINT,
    "order_id" BIGINT,
    "payment_id" BIGINT,
    "original_document_id" BIGINT,
    "credit_note_reason_id" BIGINT,
    "cn_kind" "credit_note_kind",
    "receipt_via" "receipt_via",
    "tax_nature" "tax_nature",
    "net_amount" DECIMAL(14,2) NOT NULL,
    "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_rate_pct" DECIMAL(7,4) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "wht_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cash_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deducted_prior_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "rounding_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount_due" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "due_date" DATE,
    "void_reason" TEXT,
    "voided_at" TIMESTAMPTZ(6),
    "voided_by" BIGINT,
    "pdf_file_id" BIGINT,
    "pdf_sha256" BYTEA,
    "e_tax_status" "etax_status" NOT NULL DEFAULT 'not_applicable',
    "e_tax_xml_file_id" BIGINT,
    "approval_request_id" BIGINT,
    "legal_hold" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,

    CONSTRAINT "pk_customer_documents" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_document_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "document_id" BIGINT NOT NULL,
    "line_no" SMALLINT NOT NULL,
    "order_id" BIGINT,
    "order_line_id" BIGINT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_price" DECIMAL(18,6) NOT NULL,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_rate_pct" DECIMAL(7,4) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "wht_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "revenue_category" "revenue_category",
    "tax_nature" "tax_nature",

    CONSTRAINT "pk_customer_document_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_document_links" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "document_id" BIGINT NOT NULL,
    "linked_document_id" BIGINT NOT NULL,
    "kind" "document_link_kind" NOT NULL,
    "amount" DECIMAL(14,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_customer_document_links" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note_reasons" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "code" TEXT NOT NULL,
    "statutory_category" "cn_statutory_category" NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "applies_to" "cn_applies_to" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_credit_note_reasons" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note_requests" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "order_id" BIGINT NOT NULL,
    "original_document_id" BIGINT,
    "reason_id" BIGINT NOT NULL,
    "cn_kind" "credit_note_kind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "settle_to" "credit_settlement",
    "note" TEXT NOT NULL,
    "claim_id" BIGINT,
    "status" "credit_note_request_status" NOT NULL DEFAULT 'pending_approval',
    "approval_request_id" BIGINT,
    "customer_document_id" BIGINT,
    "requested_by" BIGINT,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_credit_note_requests" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_wht_certificates" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "customer_document_id" BIGINT NOT NULL,
    "payment_id" BIGINT,
    "customer_user_id" BIGINT NOT NULL,
    "company_id" BIGINT,
    "wht_base" DECIMAL(14,2) NOT NULL,
    "wht_amount" DECIMAL(14,2) NOT NULL,
    "status" "wht_cert_status" NOT NULL DEFAULT 'pending',
    "certificate_no" TEXT,
    "certificate_date" DATE,
    "file_object_id" BIGINT,
    "received_at" TIMESTAMPTZ(6),
    "recorded_by" BIGINT,
    "waived_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_customer_wht_certificates" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivable_items" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "customer_user_id" BIGINT NOT NULL,
    "company_id" BIGINT,
    "customer_document_id" BIGINT NOT NULL,
    "order_id" BIGINT,
    "due_date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "open_amount" DECIMAL(14,2) NOT NULL,
    "vat_not_due_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_not_due_base" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "ar_item_status" NOT NULL DEFAULT 'open',
    "write_off_reason" TEXT,
    "write_off_approval_request_id" BIGINT,
    "written_off_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_receivable_items" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivable_applications" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "receivable_item_id" BIGINT NOT NULL,
    "payment_id" BIGINT,
    "document_id" BIGINT,
    "store_credit_entry_id" BIGINT,
    "amount" DECIMAL(14,2) NOT NULL,
    "applied_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_receivable_applications" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dunning_notices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "receivable_item_id" BIGINT NOT NULL,
    "stage" "dunning_stage" NOT NULL,
    "domain_event_id" UUID,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_dunning_notices" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_credit_accounts" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "customer_user_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_store_credit_accounts" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_credit_entries" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "account_id" BIGINT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "source" "store_credit_source" NOT NULL,
    "customer_document_id" BIGINT,
    "order_id" BIGINT,
    "refund_id" BIGINT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,

    CONSTRAINT "pk_store_credit_entries" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bad_debt_provisions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "fiscal_period_id" BIGINT NOT NULL,
    "receivable_item_id" BIGINT,
    "method" TEXT NOT NULL,
    "target_amount" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "basis" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,

    CONSTRAINT "pk_bad_debt_provisions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_statements" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "company_id" BIGINT NOT NULL,
    "period_month" DATE NOT NULL,
    "opening" DECIMAL(14,2) NOT NULL,
    "invoiced" DECIMAL(14,2) NOT NULL,
    "paid" DECIMAL(14,2) NOT NULL,
    "credited" DECIMAL(14,2) NOT NULL,
    "closing" DECIMAL(14,2) NOT NULL,
    "lines" JSONB NOT NULL,
    "file_object_id" BIGINT,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_company_statements" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_customer_documents__public_id" ON "customer_documents"("public_id");

-- CreateIndex
CREATE INDEX "ix_customer_documents__customer_user_id__document_date" ON "customer_documents"("customer_user_id", "document_date" DESC);

-- CreateIndex
CREATE INDEX "ix_customer_documents__company_id__document_date" ON "customer_documents"("company_id", "document_date") WHERE (company_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "ix_customer_documents__order_id" ON "customer_documents"("order_id");

-- CreateIndex
CREATE INDEX "ix_customer_documents__order_group_id" ON "customer_documents"("order_group_id");

-- CreateIndex
CREATE INDEX "ix_customer_documents__payment_id" ON "customer_documents"("payment_id");

-- CreateIndex
CREATE INDEX "ix_customer_documents__original_document_id" ON "customer_documents"("original_document_id");

-- CreateIndex
CREATE INDEX "ix_customer_documents__entity_id__doc_type__document_date" ON "customer_documents"("entity_id", "doc_type", "document_date");

-- CreateIndex
CREATE INDEX "ix_customer_documents__company_branch_id" ON "customer_documents"("company_branch_id");

-- CreateIndex
CREATE INDEX "ix_customer_documents__credit_note_reason_id" ON "customer_documents"("credit_note_reason_id");

-- CreateIndex
CREATE INDEX "ix_customer_documents__voided_by" ON "customer_documents"("voided_by");

-- CreateIndex
CREATE INDEX "ix_customer_documents__pdf_file_id" ON "customer_documents"("pdf_file_id");

-- CreateIndex
CREATE INDEX "ix_customer_documents__e_tax_xml_file_id" ON "customer_documents"("e_tax_xml_file_id");

-- CreateIndex
CREATE INDEX "ix_customer_documents__approval_request_id" ON "customer_documents"("approval_request_id");

-- CreateIndex
CREATE INDEX "ix_customer_documents__created_by" ON "customer_documents"("created_by");

-- CreateIndex
CREATE INDEX "ix_customer_documents__pdf_pending" ON "customer_documents"("issued_at") WHERE (pdf_file_id IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "ux_customer_documents__entity_id__doc_type__doc_number" ON "customer_documents"("entity_id", "doc_type", "doc_number");

-- CreateIndex
CREATE INDEX "ix_customer_document_lines__order_id" ON "customer_document_lines"("order_id");

-- CreateIndex
CREATE INDEX "ix_customer_document_lines__order_line_id" ON "customer_document_lines"("order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_customer_document_lines__document_id__line_no" ON "customer_document_lines"("document_id", "line_no");

-- CreateIndex
CREATE INDEX "ix_customer_document_links__linked_document_id" ON "customer_document_links"("linked_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_customer_document_links__document__linked__kind" ON "customer_document_links"("document_id", "linked_document_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ux_credit_note_reasons__public_id" ON "credit_note_reasons"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_credit_note_reasons__code" ON "credit_note_reasons"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ux_credit_note_requests__public_id" ON "credit_note_requests"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_credit_note_requests__customer_document_id" ON "credit_note_requests"("customer_document_id");

-- CreateIndex
CREATE INDEX "ix_credit_note_requests__order_id" ON "credit_note_requests"("order_id");

-- CreateIndex
CREATE INDEX "ix_credit_note_requests__original_document_id" ON "credit_note_requests"("original_document_id");

-- CreateIndex
CREATE INDEX "ix_credit_note_requests__reason_id" ON "credit_note_requests"("reason_id");

-- CreateIndex
CREATE INDEX "ix_credit_note_requests__claim_id" ON "credit_note_requests"("claim_id");

-- CreateIndex
CREATE INDEX "ix_credit_note_requests__approval_request_id" ON "credit_note_requests"("approval_request_id");

-- CreateIndex
CREATE INDEX "ix_credit_note_requests__requested_by" ON "credit_note_requests"("requested_by");

-- CreateIndex
CREATE INDEX "ix_credit_note_requests__entity_id__status" ON "credit_note_requests"("entity_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ux_customer_wht_certificates__public_id" ON "customer_wht_certificates"("public_id");

-- CreateIndex
CREATE INDEX "ix_customer_wht_certificates__entity_id__status" ON "customer_wht_certificates"("entity_id", "status");

-- CreateIndex
CREATE INDEX "ix_customer_wht_certificates__payment_id" ON "customer_wht_certificates"("payment_id");

-- CreateIndex
CREATE INDEX "ix_customer_wht_certificates__customer_user_id" ON "customer_wht_certificates"("customer_user_id");

-- CreateIndex
CREATE INDEX "ix_customer_wht_certificates__company_id" ON "customer_wht_certificates"("company_id");

-- CreateIndex
CREATE INDEX "ix_customer_wht_certificates__file_object_id" ON "customer_wht_certificates"("file_object_id");

-- CreateIndex
CREATE INDEX "ix_customer_wht_certificates__recorded_by" ON "customer_wht_certificates"("recorded_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_customer_wht_certificates__customer_document_id" ON "customer_wht_certificates"("customer_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_receivable_items__public_id" ON "receivable_items"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_receivable_items__customer_document_id" ON "receivable_items"("customer_document_id");

-- CreateIndex
CREATE INDEX "ix_receivable_items__company_id__status__due_date" ON "receivable_items"("company_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "ix_receivable_items__customer_user_id__status__due_date" ON "receivable_items"("customer_user_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "ix_receivable_items__order_id" ON "receivable_items"("order_id");

-- CreateIndex
CREATE INDEX "ix_receivable_items__write_off_approval_request_id" ON "receivable_items"("write_off_approval_request_id");

-- CreateIndex
CREATE INDEX "ix_receivable_items__entity_id__status" ON "receivable_items"("entity_id", "status");

-- CreateIndex
CREATE INDEX "ix_receivable_applications__receivable_item_id" ON "receivable_applications"("receivable_item_id");

-- CreateIndex
CREATE INDEX "ix_receivable_applications__payment_id" ON "receivable_applications"("payment_id");

-- CreateIndex
CREATE INDEX "ix_receivable_applications__document_id" ON "receivable_applications"("document_id");

-- CreateIndex
CREATE INDEX "ix_receivable_applications__store_credit_entry_id" ON "receivable_applications"("store_credit_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_dunning_notices__receivable_item_id__stage" ON "dunning_notices"("receivable_item_id", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "ux_store_credit_accounts__public_id" ON "store_credit_accounts"("public_id");

-- CreateIndex
CREATE INDEX "ix_store_credit_accounts__customer_user_id" ON "store_credit_accounts"("customer_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_store_credit_accounts__entity_id__customer_user_id" ON "store_credit_accounts"("entity_id", "customer_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_store_credit_entries__public_id" ON "store_credit_entries"("public_id");

-- CreateIndex
CREATE INDEX "ix_store_credit_entries__account_id__created_at" ON "store_credit_entries"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_store_credit_entries__customer_document_id" ON "store_credit_entries"("customer_document_id");

-- CreateIndex
CREATE INDEX "ix_store_credit_entries__order_id" ON "store_credit_entries"("order_id");

-- CreateIndex
CREATE INDEX "ix_store_credit_entries__created_by" ON "store_credit_entries"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_store_credit_entries__refund_id" ON "store_credit_entries"("refund_id") WHERE (refund_id IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "ux_bad_debt_provisions__public_id" ON "bad_debt_provisions"("public_id");

-- CreateIndex
CREATE INDEX "ix_bad_debt_provisions__entity_id__fiscal_period_id" ON "bad_debt_provisions"("entity_id", "fiscal_period_id");

-- CreateIndex
CREATE INDEX "ix_bad_debt_provisions__fiscal_period_id" ON "bad_debt_provisions"("fiscal_period_id");

-- CreateIndex
CREATE INDEX "ix_bad_debt_provisions__receivable_item_id" ON "bad_debt_provisions"("receivable_item_id");

-- CreateIndex
CREATE INDEX "ix_bad_debt_provisions__created_by" ON "bad_debt_provisions"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_company_statements__public_id" ON "company_statements"("public_id");

-- CreateIndex
CREATE INDEX "ix_company_statements__entity_id" ON "company_statements"("entity_id");

-- CreateIndex
CREATE INDEX "ix_company_statements__file_object_id" ON "company_statements"("file_object_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_company_statements__company_id__period_month" ON "company_statements"("company_id", "period_month");

-- AddForeignKey
ALTER TABLE "customer_documents" ADD CONSTRAINT "fk_customer_documents__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_documents" ADD CONSTRAINT "fk_customer_documents__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_documents" ADD CONSTRAINT "fk_customer_documents__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_documents" ADD CONSTRAINT "fk_customer_documents__company_branch_id" FOREIGN KEY ("company_branch_id") REFERENCES "company_branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_documents" ADD CONSTRAINT "fk_customer_documents__order_group_id" FOREIGN KEY ("order_group_id") REFERENCES "order_groups"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_documents" ADD CONSTRAINT "fk_customer_documents__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_documents" ADD CONSTRAINT "fk_customer_documents__payment_id" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_documents" ADD CONSTRAINT "fk_customer_documents__original_document_id" FOREIGN KEY ("original_document_id") REFERENCES "customer_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_documents" ADD CONSTRAINT "fk_customer_documents__credit_note_reason_id" FOREIGN KEY ("credit_note_reason_id") REFERENCES "credit_note_reasons"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_documents" ADD CONSTRAINT "fk_customer_documents__voided_by" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_documents" ADD CONSTRAINT "fk_customer_documents__pdf_file_id" FOREIGN KEY ("pdf_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_documents" ADD CONSTRAINT "fk_customer_documents__e_tax_xml_file_id" FOREIGN KEY ("e_tax_xml_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_documents" ADD CONSTRAINT "fk_customer_documents__approval_request_id" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_documents" ADD CONSTRAINT "fk_customer_documents__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_document_lines" ADD CONSTRAINT "fk_customer_document_lines__document_id" FOREIGN KEY ("document_id") REFERENCES "customer_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_document_lines" ADD CONSTRAINT "fk_customer_document_lines__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_document_lines" ADD CONSTRAINT "fk_customer_document_lines__order_line_id" FOREIGN KEY ("order_line_id") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_document_links" ADD CONSTRAINT "fk_customer_document_links__document_id" FOREIGN KEY ("document_id") REFERENCES "customer_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_document_links" ADD CONSTRAINT "fk_customer_document_links__linked_document_id" FOREIGN KEY ("linked_document_id") REFERENCES "customer_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "credit_note_requests" ADD CONSTRAINT "fk_credit_note_requests__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "credit_note_requests" ADD CONSTRAINT "fk_credit_note_requests__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "credit_note_requests" ADD CONSTRAINT "fk_credit_note_requests__original_document_id" FOREIGN KEY ("original_document_id") REFERENCES "customer_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "credit_note_requests" ADD CONSTRAINT "fk_credit_note_requests__reason_id" FOREIGN KEY ("reason_id") REFERENCES "credit_note_reasons"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "credit_note_requests" ADD CONSTRAINT "fk_credit_note_requests__claim_id" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "credit_note_requests" ADD CONSTRAINT "fk_credit_note_requests__approval_request_id" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "credit_note_requests" ADD CONSTRAINT "fk_credit_note_requests__customer_document_id" FOREIGN KEY ("customer_document_id") REFERENCES "customer_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "credit_note_requests" ADD CONSTRAINT "fk_credit_note_requests__requested_by" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_wht_certificates" ADD CONSTRAINT "fk_customer_wht_certificates__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_wht_certificates" ADD CONSTRAINT "fk_customer_wht_certificates__customer_document_id" FOREIGN KEY ("customer_document_id") REFERENCES "customer_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_wht_certificates" ADD CONSTRAINT "fk_customer_wht_certificates__payment_id" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_wht_certificates" ADD CONSTRAINT "fk_customer_wht_certificates__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_wht_certificates" ADD CONSTRAINT "fk_customer_wht_certificates__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_wht_certificates" ADD CONSTRAINT "fk_customer_wht_certificates__file_object_id" FOREIGN KEY ("file_object_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_wht_certificates" ADD CONSTRAINT "fk_customer_wht_certificates__recorded_by" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receivable_items" ADD CONSTRAINT "fk_receivable_items__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receivable_items" ADD CONSTRAINT "fk_receivable_items__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receivable_items" ADD CONSTRAINT "fk_receivable_items__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receivable_items" ADD CONSTRAINT "fk_receivable_items__customer_document_id" FOREIGN KEY ("customer_document_id") REFERENCES "customer_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receivable_items" ADD CONSTRAINT "fk_receivable_items__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receivable_items" ADD CONSTRAINT "fk_receivable_items__write_off_approval_request_id" FOREIGN KEY ("write_off_approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receivable_applications" ADD CONSTRAINT "fk_receivable_applications__receivable_item_id" FOREIGN KEY ("receivable_item_id") REFERENCES "receivable_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receivable_applications" ADD CONSTRAINT "fk_receivable_applications__payment_id" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receivable_applications" ADD CONSTRAINT "fk_receivable_applications__document_id" FOREIGN KEY ("document_id") REFERENCES "customer_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "receivable_applications" ADD CONSTRAINT "fk_receivable_applications__store_credit_entry_id" FOREIGN KEY ("store_credit_entry_id") REFERENCES "store_credit_entries"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dunning_notices" ADD CONSTRAINT "fk_dunning_notices__receivable_item_id" FOREIGN KEY ("receivable_item_id") REFERENCES "receivable_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "store_credit_accounts" ADD CONSTRAINT "fk_store_credit_accounts__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "store_credit_accounts" ADD CONSTRAINT "fk_store_credit_accounts__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "store_credit_entries" ADD CONSTRAINT "fk_store_credit_entries__account_id" FOREIGN KEY ("account_id") REFERENCES "store_credit_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "store_credit_entries" ADD CONSTRAINT "fk_store_credit_entries__customer_document_id" FOREIGN KEY ("customer_document_id") REFERENCES "customer_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "store_credit_entries" ADD CONSTRAINT "fk_store_credit_entries__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "store_credit_entries" ADD CONSTRAINT "fk_store_credit_entries__refund_id" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "store_credit_entries" ADD CONSTRAINT "fk_store_credit_entries__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "bad_debt_provisions" ADD CONSTRAINT "fk_bad_debt_provisions__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "bad_debt_provisions" ADD CONSTRAINT "fk_bad_debt_provisions__fiscal_period_id" FOREIGN KEY ("fiscal_period_id") REFERENCES "fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "bad_debt_provisions" ADD CONSTRAINT "fk_bad_debt_provisions__receivable_item_id" FOREIGN KEY ("receivable_item_id") REFERENCES "receivable_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "bad_debt_provisions" ADD CONSTRAINT "fk_bad_debt_provisions__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_statements" ADD CONSTRAINT "fk_company_statements__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_statements" ADD CONSTRAINT "fk_company_statements__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_statements" ADD CONSTRAINT "fk_company_statements__file_object_id" FOREIGN KEY ("file_object_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "claim_resolutions" ADD CONSTRAINT "fk_claim_resolutions__customer_document_id" FOREIGN KEY ("customer_document_id") REFERENCES "customer_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- =====================================================================================================
-- Hand-written: receivables & customer documents (accounting-design §2, §4, §6; schema-design §3.8, A-42)
-- =====================================================================================================

-- --- customer documents: gapless numbers per (entity, type, period) come from document_series ----------
ALTER TABLE customer_documents
  ADD CONSTRAINT ck_customer_documents__doc_type CHECK (doc_type IN ('iv', 'tr', 'rc', 'cn', 'dn')),
  ADD CONSTRAINT ck_customer_documents__doc_number CHECK (btrim(doc_number) <> ''),
  ADD CONSTRAINT ck_customer_documents__kind CHECK (
    (doc_type = 'tr' AND doc_kind IN ('instalment', 'final')) OR
    (doc_type = 'iv' AND doc_kind = 'delivery') OR
    (doc_type = 'rc' AND doc_kind = 'collection') OR
    (doc_type = 'cn' AND doc_kind = 'credit_note') OR
    (doc_type = 'dn' AND doc_kind = 'debit_note')),
  ADD CONSTRAINT ck_customer_documents__amounts CHECK (
    net_amount >= 0 AND discount_amount >= 0 AND vat_amount >= 0 AND gross_amount >= 0 AND wht_amount >= 0
    AND cash_amount >= 0 AND deducted_prior_amount >= 0 AND amount_due >= 0
    AND gross_amount = net_amount - discount_amount + vat_amount + rounding_amount),
  ADD CONSTRAINT ck_customer_documents__vat_rate CHECK (vat_rate_pct >= 0 AND vat_rate_pct <= 100),
  ADD CONSTRAINT ck_customer_documents__notes CHECK (
    doc_type NOT IN ('cn', 'dn') OR (original_document_id IS NOT NULL AND credit_note_reason_id IS NOT NULL)),
  ADD CONSTRAINT ck_customer_documents__cn_kind CHECK ((doc_type = 'cn') = (cn_kind IS NOT NULL)),
  ADD CONSTRAINT ck_customer_documents__receipt CHECK (doc_type NOT IN ('rc') OR receipt_via IS NOT NULL),
  ADD CONSTRAINT ck_customer_documents__void CHECK (
    (status = 'void') = (voided_at IS NOT NULL) AND (status <> 'void' OR btrim(coalesce(void_reason, '')) <> '')),
  ADD CONSTRAINT ck_customer_documents__pdf CHECK ((pdf_file_id IS NULL) = (pdf_sha256 IS NULL)),
  ADD CONSTRAINT ck_customer_documents__buyer CHECK (jsonb_typeof(buyer_snapshot) = 'object' AND jsonb_typeof(seller_snapshot) = 'object');

-- Issued documents keep their number and money forever; only the void, the rendered files, the e-Tax state
-- and the legal hold change afterwards. Nothing is deleted (retention ≥ 10 years, §2).
CREATE FUNCTION tg_customer_documents__issued_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'customer documents are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'void_reason' - 'voided_at' - 'voided_by' - 'pdf_file_id' - 'pdf_sha256'
                    - 'e_tax_status' - 'e_tax_xml_file_id' - 'legal_hold')
     <> (to_jsonb(OLD) - 'status' - 'void_reason' - 'voided_at' - 'voided_by' - 'pdf_file_id' - 'pdf_sha256'
                    - 'e_tax_status' - 'e_tax_xml_file_id' - 'legal_hold')
     OR (OLD.status = 'void' AND NEW.status <> 'void')
     OR (OLD.pdf_file_id IS NOT NULL AND NEW.pdf_file_id IS DISTINCT FROM OLD.pdf_file_id) THEN
    RAISE EXCEPTION 'customer document % is issued and cannot change', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_customer_documents__issued_frozen BEFORE UPDATE OR DELETE ON customer_documents
  FOR EACH ROW EXECUTE FUNCTION tg_customer_documents__issued_frozen();

ALTER TABLE customer_document_lines
  ADD CONSTRAINT ck_customer_document_lines__line_no CHECK (line_no > 0),
  ADD CONSTRAINT ck_customer_document_lines__description CHECK (btrim(description) <> ''),
  ADD CONSTRAINT ck_customer_document_lines__amounts CHECK (
    net_amount >= 0 AND discount_amount >= 0 AND vat_amount >= 0 AND wht_amount >= 0
    AND gross_amount = net_amount - discount_amount + vat_amount);
CREATE TRIGGER tg_customer_document_lines__append_only BEFORE UPDATE OR DELETE ON customer_document_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE customer_document_links
  ADD CONSTRAINT ck_customer_document_links__distinct CHECK (document_id <> linked_document_id),
  ADD CONSTRAINT ck_customer_document_links__amount CHECK (amount IS NULL OR amount >= 0);
CREATE TRIGGER tg_customer_document_links__append_only BEFORE UPDATE OR DELETE ON customer_document_links
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE credit_note_reasons
  ADD CONSTRAINT ck_credit_note_reasons__code CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  ADD CONSTRAINT ck_credit_note_reasons__names CHECK (btrim(name_th) <> '' AND btrim(name_en) <> '');

ALTER TABLE credit_note_requests
  ADD CONSTRAINT ck_credit_note_requests__amount CHECK (amount > 0),
  ADD CONSTRAINT ck_credit_note_requests__note CHECK (btrim(note) <> ''),
  ADD CONSTRAINT ck_credit_note_requests__issued CHECK ((status = 'issued') = (customer_document_id IS NOT NULL)),
  ADD CONSTRAINT ck_credit_note_requests__decided CHECK (status = 'pending_approval' OR decided_at IS NOT NULL);
CREATE TRIGGER tg_credit_note_requests__no_delete BEFORE DELETE ON credit_note_requests
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE customer_wht_certificates
  ADD CONSTRAINT ck_customer_wht_certificates__amounts CHECK (wht_amount > 0 AND wht_base >= wht_amount),
  ADD CONSTRAINT ck_customer_wht_certificates__received CHECK (
    status <> 'received' OR (certificate_no IS NOT NULL AND certificate_date IS NOT NULL AND received_at IS NOT NULL)),
  ADD CONSTRAINT ck_customer_wht_certificates__waived CHECK (status <> 'waived' OR btrim(coalesce(waived_reason, '')) <> '');
CREATE TRIGGER tg_customer_wht_certificates__no_delete BEFORE DELETE ON customer_wht_certificates
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

-- --- AR open items ------------------------------------------------------------------------------------------
ALTER TABLE receivable_items
  ADD CONSTRAINT ck_receivable_items__amounts CHECK (
    amount > 0 AND open_amount >= 0 AND open_amount <= amount AND vat_not_due_amount >= 0 AND vat_not_due_base >= 0),
  ADD CONSTRAINT ck_receivable_items__status CHECK (
    (status = 'paid') = (open_amount = 0 AND status NOT IN ('written_off', 'cancelled'))
    OR status IN ('written_off', 'cancelled')),
  ADD CONSTRAINT ck_receivable_items__written_off CHECK (
    status <> 'written_off' OR (written_off_at IS NOT NULL AND btrim(coalesce(write_off_reason, '')) <> ''));
CREATE TRIGGER tg_receivable_items__no_delete BEFORE DELETE ON receivable_items
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE receivable_applications
  ADD CONSTRAINT ck_receivable_applications__amount CHECK (amount > 0),
  ADD CONSTRAINT ck_receivable_applications__source CHECK (num_nonnulls(payment_id, document_id, store_credit_entry_id) >= 1);
CREATE TRIGGER tg_receivable_applications__append_only BEFORE UPDATE OR DELETE ON receivable_applications
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER tg_dunning_notices__append_only BEFORE UPDATE OR DELETE ON dunning_notices
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- --- store credit: an append-only wallet that never goes below zero ----------------------------------------
ALTER TABLE store_credit_entries ADD CONSTRAINT ck_store_credit_entries__amount CHECK (amount <> 0);
CREATE FUNCTION tg_store_credit_entries__balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  balance numeric(14, 2);
BEGIN
  PERFORM 1 FROM store_credit_accounts WHERE id = NEW.account_id FOR UPDATE;
  SELECT coalesce(sum(amount), 0) INTO balance FROM store_credit_entries WHERE account_id = NEW.account_id;
  IF balance + NEW.amount < 0 THEN
    RAISE EXCEPTION 'store credit account % would go below zero (balance %, movement %)', NEW.account_id, balance, NEW.amount
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_store_credit_entries__balance BEFORE INSERT ON store_credit_entries
  FOR EACH ROW EXECUTE FUNCTION tg_store_credit_entries__balance();
CREATE TRIGGER tg_store_credit_entries__append_only BEFORE UPDATE OR DELETE ON store_credit_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE bad_debt_provisions
  ADD CONSTRAINT ck_bad_debt_provisions__target CHECK (target_amount >= 0),
  ADD CONSTRAINT ck_bad_debt_provisions__method CHECK (method IN ('aging_rates', 'manual'));
CREATE TRIGGER tg_bad_debt_provisions__append_only BEFORE UPDATE OR DELETE ON bad_debt_provisions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE company_statements
  ADD CONSTRAINT ck_company_statements__month CHECK (extract(day FROM period_month) = 1),
  ADD CONSTRAINT ck_company_statements__roll CHECK (closing = opening + invoiced - paid - credited);
