-- E6 Packio Factory ERP (D-385 – D-396): the factory's own general ledger — chart of accounts, fiscal periods and
-- the month-end close, journals posted from ERP documents by versioned rules, manual and recurring journals,
-- fixed assets and depreciation, bank statements and reconciliation, tax filings. Factory-private (D-317).

-- AlterEnum
ALTER TYPE "erp_document_type" ADD VALUE 'jv';
ALTER TYPE "erp_document_type" ADD VALUE 'fa';

-- CreateEnum
CREATE TYPE "erp_gl_dimension" AS ENUM ('item', 'partner', 'warehouse', 'production_order', 'machine', 'bank_account');

-- CreateEnum
CREATE TYPE "erp_gl_asset_status" AS ENUM ('active', 'disposed', 'written_off');

-- CreateEnum
CREATE TYPE "erp_gl_bank_line_status" AS ENUM ('open', 'matched', 'ignored');

-- CreateEnum
CREATE TYPE "erp_gl_bank_match_target" AS ENUM ('supplier_payment', 'customer_receipt', 'journal_entry', 'bank_fee', 'interest');

-- CreateEnum
CREATE TYPE "erp_gl_tax_return" AS ENUM ('pp30', 'pnd3', 'pnd53');

-- CreateTable
CREATE TABLE "erp_gl_settings" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "factory_id" BIGINT NOT NULL,
    "fiscal_year_start_month" INTEGER NOT NULL DEFAULT 1,
    "ledger_start_on" DATE NOT NULL,
    "item_kind_accounts" JSONB NOT NULL DEFAULT '{}',
    "method_accounts" JSONB NOT NULL DEFAULT '{}',
    "cpa_name" TEXT,
    "cpa_contact" TEXT,
    "chart_template_version" INTEGER NOT NULL DEFAULT 1,
    "rules_template_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_gl_settings" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_gl_accounts" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "account_type" "account_type" NOT NULL,
    "normal_side" "ledger_side" NOT NULL,
    "parent_id" BIGINT,
    "is_control" BOOLEAN NOT NULL DEFAULT false,
    "is_postable" BOOLEAN NOT NULL DEFAULT true,
    "cash_flow_class" "cash_flow_class" NOT NULL,
    "statement_line" TEXT NOT NULL,
    "status" "account_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_gl_accounts" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_gl_account_changes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "account_id" BIGINT,
    "kind" "account_change_kind" NOT NULL,
    "proposed" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "config_version_status" NOT NULL DEFAULT 'proposed',
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" BIGINT,

    CONSTRAINT "pk_erp_gl_account_changes" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_gl_fiscal_years" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "label" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "closing_entry_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_erp_gl_fiscal_years" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_gl_periods" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "fiscal_year_id" BIGINT NOT NULL,
    "period_no" SMALLINT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "period_status" NOT NULL DEFAULT 'open',
    "status_changed_at" TIMESTAMPTZ(6),
    "status_changed_by" BIGINT,
    "close_checklist" JSONB,
    "close_note" TEXT,

    CONSTRAINT "pk_erp_gl_periods" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_gl_journal_entries" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "period_id" BIGINT NOT NULL,
    "entry_no" TEXT,
    "entry_date" DATE NOT NULL,
    "document_date" DATE NOT NULL,
    "kind" "journal_kind" NOT NULL,
    "status" "journal_status" NOT NULL DEFAULT 'draft',
    "source_document_type" TEXT,
    "source_document_public_id" UUID,
    "source_document_no" TEXT,
    "domain_event_id" UUID,
    "posting_rule_id" BIGINT,
    "posting_rule_version_id" BIGINT,
    "reverses_entry_id" BIGINT,
    "recurring_journal_id" BIGINT,
    "auto_reverse_on" DATE,
    "description" TEXT NOT NULL,
    "total_debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "rejection_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "approved_at" TIMESTAMPTZ(6),
    "approved_by" BIGINT,
    "posted_at" TIMESTAMPTZ(6),
    "posted_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_gl_journal_entries" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_gl_journal_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "entry_id" BIGINT NOT NULL,
    "line_no" SMALLINT NOT NULL,
    "account_id" BIGINT NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "item_id" BIGINT,
    "partner_id" BIGINT,
    "warehouse_id" BIGINT,
    "production_order_id" BIGINT,
    "machine_id" BIGINT,
    "bank_account_id" BIGINT,
    "tax_code" "tax_code",
    "tax_base_amount" DECIMAL(14,2),
    "factory_id" BIGINT NOT NULL,
    "period_id" BIGINT NOT NULL,
    "entry_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_erp_gl_journal_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_gl_posting_rules" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_erp_gl_posting_rules" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_gl_posting_rule_versions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "rule_id" BIGINT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "status" "config_version_status" NOT NULL DEFAULT 'draft',
    "conditions" JSONB,
    "template" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" BIGINT,

    CONSTRAINT "pk_erp_gl_posting_rule_versions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_gl_recurring_journals" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "day_of_month" SMALLINT NOT NULL,
    "start_on" DATE NOT NULL,
    "end_on" DATE,
    "auto_reverse" BOOLEAN NOT NULL DEFAULT false,
    "lines" JSONB NOT NULL,
    "status" "account_status" NOT NULL DEFAULT 'active',
    "last_run_month" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_gl_recurring_journals" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_gl_asset_categories" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "useful_life_months" INTEGER NOT NULL,
    "asset_account_id" BIGINT NOT NULL,
    "accumulated_account_id" BIGINT NOT NULL,
    "expense_account_id" BIGINT NOT NULL,
    "gain_loss_account_id" BIGINT NOT NULL,
    "status" "account_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,

    CONSTRAINT "pk_erp_gl_asset_categories" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_gl_fixed_assets" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "category_id" BIGINT NOT NULL,
    "machine_id" BIGINT,
    "asset_no" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "acquired_on" DATE NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "salvage_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "useful_life_months" INTEGER NOT NULL,
    "depreciation_start" DATE NOT NULL,
    "opening_accumulated" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "accumulated" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "months_depreciated" INTEGER NOT NULL DEFAULT 0,
    "status" "erp_gl_asset_status" NOT NULL DEFAULT 'active',
    "disposed_on" DATE,
    "proceeds" DECIMAL(14,2),
    "disposal_entry_id" BIGINT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_gl_fixed_assets" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_gl_depreciation_runs" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "period_id" BIGINT NOT NULL,
    "entry_id" BIGINT,
    "total" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,

    CONSTRAINT "pk_erp_gl_depreciation_runs" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_gl_depreciation_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "run_id" BIGINT NOT NULL,
    "asset_id" BIGINT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "pk_erp_gl_depreciation_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_gl_bank_accounts" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_no_last4" TEXT NOT NULL,
    "gl_account_id" BIGINT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" "account_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_erp_gl_bank_accounts" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_gl_bank_statement_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "bank_account_id" BIGINT NOT NULL,
    "txn_date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "line_hash" BYTEA NOT NULL,
    "status" "erp_gl_bank_line_status" NOT NULL DEFAULT 'open',
    "ignore_reason" TEXT,
    "imported_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported_by" BIGINT NOT NULL,

    CONSTRAINT "pk_erp_gl_bank_statement_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_gl_bank_matches" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "line_id" BIGINT NOT NULL,
    "target_type" "erp_gl_bank_match_target" NOT NULL,
    "target_public_id" UUID,
    "target_no" TEXT,
    "entry_id" BIGINT,
    "amount" DECIMAL(14,2) NOT NULL,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "matched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matched_by" BIGINT,

    CONSTRAINT "pk_erp_gl_bank_matches" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_gl_tax_filings" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "form" "erp_gl_tax_return" NOT NULL,
    "month" DATE NOT NULL,
    "filed_on" DATE NOT NULL,
    "reference" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,

    CONSTRAINT "pk_erp_gl_tax_filings" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_settings__factory_id" ON "erp_gl_settings"("factory_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_settings__created_by" ON "erp_gl_settings"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_gl_settings__updated_by" ON "erp_gl_settings"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_accounts__public_id" ON "erp_gl_accounts"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_accounts__factory_id__code" ON "erp_gl_accounts"("factory_id", "code");

-- CreateIndex
CREATE INDEX "ix_erp_gl_accounts__parent_id" ON "erp_gl_accounts"("parent_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_accounts__created_by" ON "erp_gl_accounts"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_gl_accounts__updated_by" ON "erp_gl_accounts"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_account_changes__public_id" ON "erp_gl_account_changes"("public_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_account_changes__factory_id__status" ON "erp_gl_account_changes"("factory_id", "status");

-- CreateIndex
CREATE INDEX "ix_erp_gl_account_changes__account_id" ON "erp_gl_account_changes"("account_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_account_changes__created_by" ON "erp_gl_account_changes"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_gl_account_changes__decided_by" ON "erp_gl_account_changes"("decided_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_fiscal_years__public_id" ON "erp_gl_fiscal_years"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_fiscal_years__factory_id__start_date" ON "erp_gl_fiscal_years"("factory_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_periods__public_id" ON "erp_gl_periods"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_periods__fiscal_year_id__period_no" ON "erp_gl_periods"("fiscal_year_id", "period_no");

-- CreateIndex
CREATE INDEX "ix_erp_gl_periods__factory_id__start_date" ON "erp_gl_periods"("factory_id", "start_date");

-- CreateIndex
CREATE INDEX "ix_erp_gl_periods__status_changed_by" ON "erp_gl_periods"("status_changed_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_journal_entries__public_id" ON "erp_gl_journal_entries"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_journal_entries__reverses_entry_id" ON "erp_gl_journal_entries"("reverses_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_journal_entries__factory_id__entry_no" ON "erp_gl_journal_entries"("factory_id", "entry_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_journal_entries__domain_event_id__posting_rule_id" ON "erp_gl_journal_entries"("domain_event_id", "posting_rule_id") WHERE (domain_event_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "ix_erp_gl_journal_entries__factory_id__entry_date" ON "erp_gl_journal_entries"("factory_id", "entry_date");

-- CreateIndex
CREATE INDEX "ix_erp_gl_journal_entries__period_id__status" ON "erp_gl_journal_entries"("period_id", "status");

-- CreateIndex
CREATE INDEX "ix_erp_gl_journal_entries__source" ON "erp_gl_journal_entries"("factory_id", "source_document_type", "source_document_public_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_journal_entries__posting_rule_id" ON "erp_gl_journal_entries"("posting_rule_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_journal_entries__posting_rule_version_id" ON "erp_gl_journal_entries"("posting_rule_version_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_journal_entries__recurring_journal_id" ON "erp_gl_journal_entries"("recurring_journal_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_journal_entries__created_by" ON "erp_gl_journal_entries"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_gl_journal_entries__approved_by" ON "erp_gl_journal_entries"("approved_by");

-- CreateIndex
CREATE INDEX "ix_erp_gl_journal_entries__posted_by" ON "erp_gl_journal_entries"("posted_by");

-- CreateIndex
CREATE INDEX "ix_erp_gl_journal_entries__auto_reverse_on" ON "erp_gl_journal_entries"("auto_reverse_on") WHERE (auto_reverse_on IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_journal_lines__entry_id__line_no" ON "erp_gl_journal_lines"("entry_id", "line_no");

-- CreateIndex
CREATE INDEX "ix_erp_gl_journal_lines__account_id__entry_date" ON "erp_gl_journal_lines"("account_id", "entry_date");

-- CreateIndex
CREATE INDEX "ix_erp_gl_journal_lines__factory_id__period_id__account_id" ON "erp_gl_journal_lines"("factory_id", "period_id", "account_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_journal_lines__period_id" ON "erp_gl_journal_lines"("period_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_journal_lines__item_id" ON "erp_gl_journal_lines"("item_id") WHERE (item_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "ix_erp_gl_journal_lines__partner_id" ON "erp_gl_journal_lines"("partner_id") WHERE (partner_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "ix_erp_gl_journal_lines__warehouse_id" ON "erp_gl_journal_lines"("warehouse_id") WHERE (warehouse_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "ix_erp_gl_journal_lines__production_order_id" ON "erp_gl_journal_lines"("production_order_id") WHERE (production_order_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "ix_erp_gl_journal_lines__machine_id" ON "erp_gl_journal_lines"("machine_id") WHERE (machine_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "ix_erp_gl_journal_lines__bank_account_id" ON "erp_gl_journal_lines"("bank_account_id") WHERE (bank_account_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "ix_erp_gl_journal_lines__tax_code__entry_date" ON "erp_gl_journal_lines"("tax_code", "entry_date") WHERE (tax_code IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_posting_rules__public_id" ON "erp_gl_posting_rules"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_posting_rules__factory_id__key" ON "erp_gl_posting_rules"("factory_id", "key");

-- CreateIndex
CREATE INDEX "ix_erp_gl_posting_rules__factory_id__event_type" ON "erp_gl_posting_rules"("factory_id", "event_type");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_posting_rule_versions__public_id" ON "erp_gl_posting_rule_versions"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_posting_rule_versions__rule_id__version_no" ON "erp_gl_posting_rule_versions"("rule_id", "version_no");

-- CreateIndex
CREATE INDEX "ix_erp_gl_posting_rule_versions__resolution" ON "erp_gl_posting_rule_versions"("rule_id", "effective_from" DESC, "version_no" DESC) WHERE (status = 'approved'::config_version_status);

-- CreateIndex
CREATE INDEX "ix_erp_gl_posting_rule_versions__created_by" ON "erp_gl_posting_rule_versions"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_gl_posting_rule_versions__decided_by" ON "erp_gl_posting_rule_versions"("decided_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_recurring_journals__public_id" ON "erp_gl_recurring_journals"("public_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_recurring_journals__factory_id__status" ON "erp_gl_recurring_journals"("factory_id", "status");

-- CreateIndex
CREATE INDEX "ix_erp_gl_recurring_journals__created_by" ON "erp_gl_recurring_journals"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_gl_recurring_journals__updated_by" ON "erp_gl_recurring_journals"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_asset_categories__public_id" ON "erp_gl_asset_categories"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_asset_categories__factory_id__name" ON "erp_gl_asset_categories"("factory_id", "name");

-- CreateIndex
CREATE INDEX "ix_erp_gl_asset_categories__asset_account_id" ON "erp_gl_asset_categories"("asset_account_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_asset_categories__accumulated_account_id" ON "erp_gl_asset_categories"("accumulated_account_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_asset_categories__expense_account_id" ON "erp_gl_asset_categories"("expense_account_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_asset_categories__gain_loss_account_id" ON "erp_gl_asset_categories"("gain_loss_account_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_asset_categories__created_by" ON "erp_gl_asset_categories"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_fixed_assets__public_id" ON "erp_gl_fixed_assets"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_fixed_assets__factory_id__asset_no" ON "erp_gl_fixed_assets"("factory_id", "asset_no");

-- CreateIndex
CREATE INDEX "ix_erp_gl_fixed_assets__factory_id__status" ON "erp_gl_fixed_assets"("factory_id", "status");

-- CreateIndex
CREATE INDEX "ix_erp_gl_fixed_assets__category_id" ON "erp_gl_fixed_assets"("category_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_fixed_assets__machine_id" ON "erp_gl_fixed_assets"("machine_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_fixed_assets__created_by" ON "erp_gl_fixed_assets"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_gl_fixed_assets__updated_by" ON "erp_gl_fixed_assets"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_depreciation_runs__public_id" ON "erp_gl_depreciation_runs"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_depreciation_runs__period_id" ON "erp_gl_depreciation_runs"("period_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_depreciation_runs__entry_id" ON "erp_gl_depreciation_runs"("entry_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_depreciation_runs__factory_id" ON "erp_gl_depreciation_runs"("factory_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_depreciation_runs__created_by" ON "erp_gl_depreciation_runs"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_depreciation_lines__run_id__asset_id" ON "erp_gl_depreciation_lines"("run_id", "asset_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_depreciation_lines__asset_id" ON "erp_gl_depreciation_lines"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_bank_accounts__public_id" ON "erp_gl_bank_accounts"("public_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_bank_accounts__factory_id__status" ON "erp_gl_bank_accounts"("factory_id", "status");

-- CreateIndex
CREATE INDEX "ix_erp_gl_bank_accounts__gl_account_id" ON "erp_gl_bank_accounts"("gl_account_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_bank_accounts__created_by" ON "erp_gl_bank_accounts"("created_by");

-- CreateIndex
CREATE INDEX "ix_erp_gl_bank_accounts__updated_by" ON "erp_gl_bank_accounts"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_bank_statement_lines__public_id" ON "erp_gl_bank_statement_lines"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_bank_statement_lines__bank_account_id__line_hash" ON "erp_gl_bank_statement_lines"("bank_account_id", "line_hash");

-- CreateIndex
CREATE INDEX "ix_erp_gl_bank_statement_lines__factory_id__status__txn_date" ON "erp_gl_bank_statement_lines"("factory_id", "status", "txn_date");

-- CreateIndex
CREATE INDEX "ix_erp_gl_bank_statement_lines__imported_by" ON "erp_gl_bank_statement_lines"("imported_by");

-- CreateIndex
CREATE INDEX "ix_erp_gl_bank_matches__line_id" ON "erp_gl_bank_matches"("line_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_bank_matches__target" ON "erp_gl_bank_matches"("target_type", "target_public_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_bank_matches__entry_id" ON "erp_gl_bank_matches"("entry_id");

-- CreateIndex
CREATE INDEX "ix_erp_gl_bank_matches__matched_by" ON "erp_gl_bank_matches"("matched_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_tax_filings__public_id" ON "erp_gl_tax_filings"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_erp_gl_tax_filings__factory_id__form__month" ON "erp_gl_tax_filings"("factory_id", "form", "month");

-- CreateIndex
CREATE INDEX "ix_erp_gl_tax_filings__created_by" ON "erp_gl_tax_filings"("created_by");

-- AddForeignKey
ALTER TABLE "erp_gl_settings" ADD CONSTRAINT "fk_erp_gl_settings__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_settings" ADD CONSTRAINT "fk_erp_gl_settings__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_settings" ADD CONSTRAINT "fk_erp_gl_settings__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_accounts" ADD CONSTRAINT "fk_erp_gl_accounts__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_accounts" ADD CONSTRAINT "fk_erp_gl_accounts__parent_id" FOREIGN KEY ("parent_id") REFERENCES "erp_gl_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_accounts" ADD CONSTRAINT "fk_erp_gl_accounts__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_accounts" ADD CONSTRAINT "fk_erp_gl_accounts__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_account_changes" ADD CONSTRAINT "fk_erp_gl_account_changes__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_account_changes" ADD CONSTRAINT "fk_erp_gl_account_changes__account_id" FOREIGN KEY ("account_id") REFERENCES "erp_gl_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_account_changes" ADD CONSTRAINT "fk_erp_gl_account_changes__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_account_changes" ADD CONSTRAINT "fk_erp_gl_account_changes__decided_by" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_fiscal_years" ADD CONSTRAINT "fk_erp_gl_fiscal_years__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_periods" ADD CONSTRAINT "fk_erp_gl_periods__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_periods" ADD CONSTRAINT "fk_erp_gl_periods__fiscal_year_id" FOREIGN KEY ("fiscal_year_id") REFERENCES "erp_gl_fiscal_years"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_periods" ADD CONSTRAINT "fk_erp_gl_periods__status_changed_by" FOREIGN KEY ("status_changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_journal_entries" ADD CONSTRAINT "fk_erp_gl_journal_entries__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_journal_entries" ADD CONSTRAINT "fk_erp_gl_journal_entries__period_id" FOREIGN KEY ("period_id") REFERENCES "erp_gl_periods"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_journal_entries" ADD CONSTRAINT "fk_erp_gl_journal_entries__posting_rule_id" FOREIGN KEY ("posting_rule_id") REFERENCES "erp_gl_posting_rules"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_journal_entries" ADD CONSTRAINT "fk_erp_gl_journal_entries__posting_rule_version_id" FOREIGN KEY ("posting_rule_version_id") REFERENCES "erp_gl_posting_rule_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_journal_entries" ADD CONSTRAINT "fk_erp_gl_journal_entries__reverses_entry_id" FOREIGN KEY ("reverses_entry_id") REFERENCES "erp_gl_journal_entries"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_journal_entries" ADD CONSTRAINT "fk_erp_gl_journal_entries__recurring_journal_id" FOREIGN KEY ("recurring_journal_id") REFERENCES "erp_gl_recurring_journals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_journal_entries" ADD CONSTRAINT "fk_erp_gl_journal_entries__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_journal_entries" ADD CONSTRAINT "fk_erp_gl_journal_entries__approved_by" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_journal_entries" ADD CONSTRAINT "fk_erp_gl_journal_entries__posted_by" FOREIGN KEY ("posted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_journal_lines" ADD CONSTRAINT "fk_erp_gl_journal_lines__entry_id" FOREIGN KEY ("entry_id") REFERENCES "erp_gl_journal_entries"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_journal_lines" ADD CONSTRAINT "fk_erp_gl_journal_lines__account_id" FOREIGN KEY ("account_id") REFERENCES "erp_gl_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_journal_lines" ADD CONSTRAINT "fk_erp_gl_journal_lines__item_id" FOREIGN KEY ("item_id") REFERENCES "erp_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_journal_lines" ADD CONSTRAINT "fk_erp_gl_journal_lines__partner_id" FOREIGN KEY ("partner_id") REFERENCES "erp_trading_partners"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_journal_lines" ADD CONSTRAINT "fk_erp_gl_journal_lines__warehouse_id" FOREIGN KEY ("warehouse_id") REFERENCES "erp_warehouses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_journal_lines" ADD CONSTRAINT "fk_erp_gl_journal_lines__production_order_id" FOREIGN KEY ("production_order_id") REFERENCES "erp_production_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_journal_lines" ADD CONSTRAINT "fk_erp_gl_journal_lines__machine_id" FOREIGN KEY ("machine_id") REFERENCES "factory_machines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_journal_lines" ADD CONSTRAINT "fk_erp_gl_journal_lines__bank_account_id" FOREIGN KEY ("bank_account_id") REFERENCES "erp_gl_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_journal_lines" ADD CONSTRAINT "fk_erp_gl_journal_lines__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_journal_lines" ADD CONSTRAINT "fk_erp_gl_journal_lines__period_id" FOREIGN KEY ("period_id") REFERENCES "erp_gl_periods"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_posting_rules" ADD CONSTRAINT "fk_erp_gl_posting_rules__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_posting_rule_versions" ADD CONSTRAINT "fk_erp_gl_posting_rule_versions__rule_id" FOREIGN KEY ("rule_id") REFERENCES "erp_gl_posting_rules"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_posting_rule_versions" ADD CONSTRAINT "fk_erp_gl_posting_rule_versions__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_posting_rule_versions" ADD CONSTRAINT "fk_erp_gl_posting_rule_versions__decided_by" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_recurring_journals" ADD CONSTRAINT "fk_erp_gl_recurring_journals__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_recurring_journals" ADD CONSTRAINT "fk_erp_gl_recurring_journals__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_recurring_journals" ADD CONSTRAINT "fk_erp_gl_recurring_journals__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_asset_categories" ADD CONSTRAINT "fk_erp_gl_asset_categories__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_asset_categories" ADD CONSTRAINT "fk_erp_gl_asset_categories__asset_account_id" FOREIGN KEY ("asset_account_id") REFERENCES "erp_gl_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_asset_categories" ADD CONSTRAINT "fk_erp_gl_asset_categories__accumulated_account_id" FOREIGN KEY ("accumulated_account_id") REFERENCES "erp_gl_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_asset_categories" ADD CONSTRAINT "fk_erp_gl_asset_categories__expense_account_id" FOREIGN KEY ("expense_account_id") REFERENCES "erp_gl_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_asset_categories" ADD CONSTRAINT "fk_erp_gl_asset_categories__gain_loss_account_id" FOREIGN KEY ("gain_loss_account_id") REFERENCES "erp_gl_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_asset_categories" ADD CONSTRAINT "fk_erp_gl_asset_categories__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_fixed_assets" ADD CONSTRAINT "fk_erp_gl_fixed_assets__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_fixed_assets" ADD CONSTRAINT "fk_erp_gl_fixed_assets__category_id" FOREIGN KEY ("category_id") REFERENCES "erp_gl_asset_categories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_fixed_assets" ADD CONSTRAINT "fk_erp_gl_fixed_assets__machine_id" FOREIGN KEY ("machine_id") REFERENCES "factory_machines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_fixed_assets" ADD CONSTRAINT "fk_erp_gl_fixed_assets__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_fixed_assets" ADD CONSTRAINT "fk_erp_gl_fixed_assets__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_depreciation_runs" ADD CONSTRAINT "fk_erp_gl_depreciation_runs__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_depreciation_runs" ADD CONSTRAINT "fk_erp_gl_depreciation_runs__period_id" FOREIGN KEY ("period_id") REFERENCES "erp_gl_periods"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_depreciation_runs" ADD CONSTRAINT "fk_erp_gl_depreciation_runs__entry_id" FOREIGN KEY ("entry_id") REFERENCES "erp_gl_journal_entries"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_depreciation_runs" ADD CONSTRAINT "fk_erp_gl_depreciation_runs__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_depreciation_lines" ADD CONSTRAINT "fk_erp_gl_depreciation_lines__run_id" FOREIGN KEY ("run_id") REFERENCES "erp_gl_depreciation_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_depreciation_lines" ADD CONSTRAINT "fk_erp_gl_depreciation_lines__asset_id" FOREIGN KEY ("asset_id") REFERENCES "erp_gl_fixed_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_bank_accounts" ADD CONSTRAINT "fk_erp_gl_bank_accounts__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_bank_accounts" ADD CONSTRAINT "fk_erp_gl_bank_accounts__gl_account_id" FOREIGN KEY ("gl_account_id") REFERENCES "erp_gl_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_bank_accounts" ADD CONSTRAINT "fk_erp_gl_bank_accounts__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_bank_accounts" ADD CONSTRAINT "fk_erp_gl_bank_accounts__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_bank_statement_lines" ADD CONSTRAINT "fk_erp_gl_bank_statement_lines__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_bank_statement_lines" ADD CONSTRAINT "fk_erp_gl_bank_statement_lines__bank_account_id" FOREIGN KEY ("bank_account_id") REFERENCES "erp_gl_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_bank_statement_lines" ADD CONSTRAINT "fk_erp_gl_bank_statement_lines__imported_by" FOREIGN KEY ("imported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_bank_matches" ADD CONSTRAINT "fk_erp_gl_bank_matches__line_id" FOREIGN KEY ("line_id") REFERENCES "erp_gl_bank_statement_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_bank_matches" ADD CONSTRAINT "fk_erp_gl_bank_matches__entry_id" FOREIGN KEY ("entry_id") REFERENCES "erp_gl_journal_entries"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_bank_matches" ADD CONSTRAINT "fk_erp_gl_bank_matches__matched_by" FOREIGN KEY ("matched_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_tax_filings" ADD CONSTRAINT "fk_erp_gl_tax_filings__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "erp_gl_tax_filings" ADD CONSTRAINT "fk_erp_gl_tax_filings__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- =====================================================================================================
-- Hand-written: factory ledger discipline (E6 §6, §10) — the same rules as Packio's own books
-- (20261015000001_finance_ledger), keyed by factory instead of entity.
-- =====================================================================================================

-- --- settings -----------------------------------------------------------------------------------------
ALTER TABLE erp_gl_settings
  ADD CONSTRAINT ck_erp_gl_settings__fiscal_year_start_month CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  ADD CONSTRAINT ck_erp_gl_settings__templates CHECK (chart_template_version > 0 AND rules_template_version > 0);

-- --- fiscal years & periods (§6) ---------------------------------------------------------------------
ALTER TABLE erp_gl_fiscal_years
  ADD CONSTRAINT ck_erp_gl_fiscal_years__dates CHECK (end_date >= start_date),
  ADD CONSTRAINT ck_erp_gl_fiscal_years__label CHECK (btrim(label) <> '');
ALTER TABLE erp_gl_fiscal_years ADD CONSTRAINT ex_erp_gl_fiscal_years__no_overlap
  EXCLUDE USING gist (factory_id WITH =, daterange(start_date, end_date, '[]') WITH &&);

ALTER TABLE erp_gl_periods
  ADD CONSTRAINT ck_erp_gl_periods__dates CHECK (end_date >= start_date),
  ADD CONSTRAINT ck_erp_gl_periods__period_no CHECK (period_no BETWEEN 1 AND 13),
  ADD CONSTRAINT ck_erp_gl_periods__status_changed CHECK (status = 'open' OR status_changed_at IS NOT NULL);
ALTER TABLE erp_gl_periods ADD CONSTRAINT ex_erp_gl_periods__no_overlap
  EXCLUDE USING gist (factory_id WITH =, daterange(start_date, end_date, '[]') WITH &&);
-- Dates never move; a locked period (CPA sign-off) never reopens; only an open period with no entries (the FK)
-- is ever deleted — a fiscal-year change before the first posting (D-390).
CREATE FUNCTION tg_erp_gl_periods__guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'open' THEN
      RAISE EXCEPTION 'factory fiscal period % is % and cannot be deleted', OLD.id, OLD.status USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.factory_id <> OLD.factory_id OR NEW.fiscal_year_id <> OLD.fiscal_year_id OR NEW.period_no <> OLD.period_no
     OR NEW.start_date <> OLD.start_date OR NEW.end_date <> OLD.end_date THEN
    RAISE EXCEPTION 'factory fiscal period % cannot move', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'locked' AND NEW.status <> 'locked' THEN
    RAISE EXCEPTION 'factory fiscal period % is locked', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_erp_gl_periods__guard BEFORE UPDATE OR DELETE ON erp_gl_periods
  FOR EACH ROW EXECUTE FUNCTION tg_erp_gl_periods__guard();

-- --- chart of accounts (§4) ---------------------------------------------------------------------------
ALTER TABLE erp_gl_accounts
  ADD CONSTRAINT ck_erp_gl_accounts__code CHECK (code ~ '^[0-9A-Z][0-9A-Z.-]*$'),
  ADD CONSTRAINT ck_erp_gl_accounts__names CHECK (btrim(name_th) <> '' AND btrim(name_en) <> ''),
  ADD CONSTRAINT ck_erp_gl_accounts__statement_line CHECK (btrim(statement_line) <> ''),
  ADD CONSTRAINT ck_erp_gl_accounts__not_own_parent CHECK (parent_id IS NULL OR parent_id <> id);
CREATE TRIGGER tg_erp_gl_accounts__no_delete BEFORE DELETE ON erp_gl_accounts
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE erp_gl_account_changes
  ADD CONSTRAINT ck_erp_gl_account_changes__reason CHECK (btrim(reason) <> ''),
  ADD CONSTRAINT ck_erp_gl_account_changes__target CHECK ((kind = 'create') = (account_id IS NULL)),
  ADD CONSTRAINT ck_erp_gl_account_changes__status CHECK (status IN ('proposed', 'approved', 'rejected', 'withdrawn')),
  ADD CONSTRAINT ck_erp_gl_account_changes__decided CHECK (status = 'proposed' OR decided_at IS NOT NULL);
CREATE TRIGGER tg_erp_gl_account_changes__immutable BEFORE UPDATE OR DELETE ON erp_gl_account_changes
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_version_change();

-- --- journals (§5 immutable, balanced; §6 period discipline; control accounts) ----------------------
ALTER TABLE erp_gl_journal_entries
  ADD CONSTRAINT ck_erp_gl_journal_entries__description CHECK (btrim(description) <> ''),
  ADD CONSTRAINT ck_erp_gl_journal_entries__totals CHECK (total_debit >= 0 AND total_credit >= 0),
  ADD CONSTRAINT ck_erp_gl_journal_entries__posted CHECK (
    status <> 'posted' OR (entry_no IS NOT NULL AND posted_at IS NOT NULL
                           AND total_debit = total_credit AND total_debit > 0)),
  ADD CONSTRAINT ck_erp_gl_journal_entries__rejected CHECK (status <> 'rejected' OR btrim(coalesce(rejection_reason, '')) <> ''),
  ADD CONSTRAINT ck_erp_gl_journal_entries__auto CHECK (kind <> 'auto' OR (posting_rule_version_id IS NOT NULL AND posting_rule_id IS NOT NULL)),
  ADD CONSTRAINT ck_erp_gl_journal_entries__reversal CHECK ((kind = 'reversal') = (reverses_entry_id IS NOT NULL)),
  ADD CONSTRAINT ck_erp_gl_journal_entries__manual CHECK (kind NOT IN ('manual', 'recurring') OR domain_event_id IS NULL),
  ADD CONSTRAINT ck_erp_gl_journal_entries__recurring CHECK ((kind = 'recurring') = (recurring_journal_id IS NOT NULL)),
  ADD CONSTRAINT ck_erp_gl_journal_entries__source CHECK ((source_document_type IS NULL) = (source_document_public_id IS NULL));

-- Posted and rejected entries never change and are never deleted.
CREATE FUNCTION tg_erp_gl_journal_entries__guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('posted', 'rejected') THEN
    RAISE EXCEPTION 'factory journal entry % is % and cannot be changed', OLD.id, OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_erp_gl_journal_entries__guard BEFORE UPDATE OR DELETE ON erp_gl_journal_entries
  FOR EACH ROW EXECUTE FUNCTION tg_erp_gl_journal_entries__guard();

-- Posting needs an open period of the entry's factory that contains the entry date; a soft-closed period only
-- when the posting session set `packio.erp_post_soft_closed` (permission `factory_ledger.close`).
CREATE FUNCTION tg_erp_gl_journal_entries__period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p erp_gl_periods%ROWTYPE;
BEGIN
  IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
  SELECT * INTO p FROM erp_gl_periods WHERE id = NEW.period_id;
  IF p.factory_id <> NEW.factory_id OR NEW.entry_date NOT BETWEEN p.start_date AND p.end_date THEN
    RAISE EXCEPTION 'entry date % is outside factory fiscal period %', NEW.entry_date, p.id USING ERRCODE = 'check_violation';
  END IF;
  IF p.status = 'open' OR (p.status = 'soft_closed' AND current_setting('packio.erp_post_soft_closed', true) = 'on') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'erp.ledger_period_closed: factory fiscal period % is %', p.id, p.status USING ERRCODE = 'restrict_violation';
END
$$;
CREATE TRIGGER tg_erp_gl_journal_entries__period BEFORE INSERT OR UPDATE OF status ON erp_gl_journal_entries
  FOR EACH ROW EXECUTE FUNCTION tg_erp_gl_journal_entries__period();

-- At commit: a posted entry has ≥ 2 lines that balance and match its totals, on active postable accounts of its
-- factory; control accounts only from automatic entries (posted from documents) or their reversals.
CREATE FUNCTION tg_erp_gl_journal_entries__balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  n integer;
  dr numeric(14, 2);
  cr numeric(14, 2);
  bad text;
  from_sub_ledger boolean;
BEGIN
  IF NEW.status <> 'posted' THEN RETURN NULL; END IF;
  SELECT count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0) INTO n, dr, cr
    FROM erp_gl_journal_lines WHERE entry_id = NEW.id;
  IF n < 2 OR dr <> cr OR dr <> NEW.total_debit OR cr <> NEW.total_credit THEN
    RAISE EXCEPTION 'erp.ledger_unbalanced: factory journal entry % has % lines, debit %, credit % (totals %/%)',
      NEW.id, n, dr, cr, NEW.total_debit, NEW.total_credit USING ERRCODE = 'check_violation';
  END IF;
  from_sub_ledger := NEW.kind IN ('auto', 'closing') OR (NEW.kind = 'reversal' AND EXISTS (
    SELECT 1 FROM erp_gl_journal_entries r WHERE r.id = NEW.reverses_entry_id AND r.kind = 'auto'));
  SELECT a.code INTO bad
    FROM erp_gl_journal_lines l JOIN erp_gl_accounts a ON a.id = l.account_id
   WHERE l.entry_id = NEW.id AND (
         a.factory_id <> NEW.factory_id OR a.status <> 'active' OR NOT a.is_postable
      OR (a.is_control AND NOT from_sub_ledger))
   LIMIT 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'erp.ledger_account_rule: factory journal entry % breaks the rules of account %', NEW.id, bad
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER tg_erp_gl_journal_entries__balanced AFTER INSERT OR UPDATE ON erp_gl_journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.status = 'posted')
  EXECUTE FUNCTION tg_erp_gl_journal_entries__balanced();

ALTER TABLE erp_gl_journal_lines
  ADD CONSTRAINT ck_erp_gl_journal_lines__sides CHECK (debit >= 0 AND credit >= 0 AND (debit = 0) <> (credit = 0)),
  ADD CONSTRAINT ck_erp_gl_journal_lines__line_no CHECK (line_no > 0),
  ADD CONSTRAINT ck_erp_gl_journal_lines__tax CHECK (tax_base_amount IS NULL OR tax_code IS NOT NULL);
-- Lines belong to an entry that is still being written; posted lines never change. The reporting columns are
-- copied from the entry.
CREATE FUNCTION tg_erp_gl_journal_lines__guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  e erp_gl_journal_entries%ROWTYPE;
BEGIN
  SELECT * INTO e FROM erp_gl_journal_entries WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.entry_id ELSE NEW.entry_id END;
  IF e.status IN ('posted', 'rejected') THEN
    RAISE EXCEPTION 'lines of factory journal entry % are frozen (%)', e.id, e.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  NEW.factory_id := e.factory_id;
  NEW.period_id := e.period_id;
  NEW.entry_date := e.entry_date;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_erp_gl_journal_lines__guard BEFORE INSERT OR UPDATE OR DELETE ON erp_gl_journal_lines
  FOR EACH ROW EXECUTE FUNCTION tg_erp_gl_journal_lines__guard();
-- Posting the entry refreshes the lines' copy of its period and date (they may move to the next open period).
CREATE FUNCTION tg_erp_gl_journal_entries__sync_lines() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.period_id IS DISTINCT FROM OLD.period_id OR NEW.entry_date IS DISTINCT FROM OLD.entry_date THEN
    UPDATE erp_gl_journal_lines SET period_id = NEW.period_id, entry_date = NEW.entry_date WHERE entry_id = NEW.id;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER tg_erp_gl_journal_entries__sync_lines AFTER UPDATE OF period_id, entry_date ON erp_gl_journal_entries
  FOR EACH ROW WHEN (NEW.status NOT IN ('posted', 'rejected'))
  EXECUTE FUNCTION tg_erp_gl_journal_entries__sync_lines();

-- --- posting rules (§5; versions are immutable once decided) -----------------------------------------
ALTER TABLE erp_gl_posting_rules
  ADD CONSTRAINT ck_erp_gl_posting_rules__key CHECK (key ~ '^[A-Z]{1,3}[0-9]{2}[A-Z]?$'),
  ADD CONSTRAINT ck_erp_gl_posting_rules__event_type CHECK (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$');
ALTER TABLE erp_gl_posting_rule_versions
  ADD CONSTRAINT ck_erp_gl_posting_rule_versions__version_no CHECK (version_no > 0),
  ADD CONSTRAINT ck_erp_gl_posting_rule_versions__reason CHECK (btrim(reason) <> ''),
  ADD CONSTRAINT ck_erp_gl_posting_rule_versions__decided CHECK (status NOT IN ('approved', 'rejected') OR decided_at IS NOT NULL),
  ADD CONSTRAINT ck_erp_gl_posting_rule_versions__template CHECK (jsonb_typeof(template) = 'object' AND jsonb_typeof(template -> 'lines') = 'array');
CREATE TRIGGER tg_erp_gl_posting_rule_versions__immutable BEFORE UPDATE OR DELETE ON erp_gl_posting_rule_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_version_change();

-- --- recurring journals, fixed assets, bank, tax (§7, §9) -------------------------------------------
ALTER TABLE erp_gl_recurring_journals
  ADD CONSTRAINT ck_erp_gl_recurring_journals__day_of_month CHECK (day_of_month BETWEEN 1 AND 28),
  ADD CONSTRAINT ck_erp_gl_recurring_journals__window CHECK (end_on IS NULL OR end_on >= start_on),
  ADD CONSTRAINT ck_erp_gl_recurring_journals__name CHECK (btrim(name) <> ''),
  ADD CONSTRAINT ck_erp_gl_recurring_journals__lines CHECK (jsonb_typeof(lines) = 'array');
ALTER TABLE erp_gl_asset_categories
  ADD CONSTRAINT ck_erp_gl_asset_categories__name CHECK (btrim(name) <> ''),
  ADD CONSTRAINT ck_erp_gl_asset_categories__life CHECK (useful_life_months > 0);
ALTER TABLE erp_gl_fixed_assets
  ADD CONSTRAINT ck_erp_gl_fixed_assets__name CHECK (btrim(name) <> ''),
  ADD CONSTRAINT ck_erp_gl_fixed_assets__amounts CHECK (cost > 0 AND salvage_value >= 0 AND salvage_value <= cost
                                                       AND opening_accumulated >= 0 AND accumulated >= 0 AND accumulated <= cost - salvage_value),
  ADD CONSTRAINT ck_erp_gl_fixed_assets__life CHECK (useful_life_months > 0 AND months_depreciated >= 0),
  ADD CONSTRAINT ck_erp_gl_fixed_assets__disposed CHECK (status = 'active' OR disposed_on IS NOT NULL);
ALTER TABLE erp_gl_depreciation_runs
  ADD CONSTRAINT ck_erp_gl_depreciation_runs__total CHECK (total >= 0);
ALTER TABLE erp_gl_depreciation_lines
  ADD CONSTRAINT ck_erp_gl_depreciation_lines__amount CHECK (amount >= 0);
ALTER TABLE erp_gl_bank_accounts
  ADD CONSTRAINT ck_erp_gl_bank_accounts__name CHECK (btrim(name) <> '');
ALTER TABLE erp_gl_bank_statement_lines
  ADD CONSTRAINT ck_erp_gl_bank_statement_lines__amount CHECK (amount <> 0),
  ADD CONSTRAINT ck_erp_gl_bank_statement_lines__ignored CHECK (status <> 'ignored' OR btrim(coalesce(ignore_reason, '')) <> '');
ALTER TABLE erp_gl_bank_matches
  ADD CONSTRAINT ck_erp_gl_bank_matches__amount CHECK (amount <> 0);
ALTER TABLE erp_gl_tax_filings
  ADD CONSTRAINT ck_erp_gl_tax_filings__month CHECK (extract(day FROM month) = 1);
