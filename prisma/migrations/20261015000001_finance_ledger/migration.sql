-- CreateEnum
CREATE TYPE "period_status" AS ENUM ('open', 'soft_closed', 'closed', 'locked');

-- CreateEnum
CREATE TYPE "account_type" AS ENUM ('asset', 'liability', 'equity', 'revenue', 'cost_of_sales', 'expense');

-- CreateEnum
CREATE TYPE "ledger_side" AS ENUM ('debit', 'credit');

-- CreateEnum
CREATE TYPE "ledger_dimension" AS ENUM ('order', 'order_group', 'customer', 'company', 'factory', 'vendor', 'product_type', 'channel', 'campaign', 'promotion', 'cost_centre');

-- CreateEnum
CREATE TYPE "account_status" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "cash_flow_class" AS ENUM ('cash', 'operating', 'investing', 'financing', 'equity', 'non_cash');

-- CreateEnum
CREATE TYPE "journal_kind" AS ENUM ('auto', 'manual', 'reversal', 'recurring', 'closing');

-- CreateEnum
CREATE TYPE "journal_status" AS ENUM ('draft', 'pending_approval', 'posted', 'rejected');

-- CreateEnum
CREATE TYPE "tax_code" AS ENUM ('output_vat', 'output_vat_not_due', 'input_vat', 'input_vat_pending', 'wht_receivable', 'wht_pnd3', 'wht_pnd53');

-- CreateEnum
CREATE TYPE "account_change_kind" AS ENUM ('create', 'update', 'deactivate', 'reactivate');

-- CreateEnum
CREATE TYPE "recurring_journal_status" AS ENUM ('pending_approval', 'active', 'paused', 'ended', 'rejected');

-- CreateTable
CREATE TABLE "fiscal_years" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "label" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "period_status" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_fiscal_years" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_periods" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "fiscal_year_id" BIGINT NOT NULL,
    "period_no" SMALLINT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "period_status" NOT NULL DEFAULT 'open',
    "status_changed_at" TIMESTAMPTZ(6),
    "status_changed_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_fiscal_periods" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "account_type" "account_type" NOT NULL,
    "normal_side" "ledger_side" NOT NULL,
    "parent_id" BIGINT,
    "is_control" BOOLEAN NOT NULL DEFAULT false,
    "is_postable" BOOLEAN NOT NULL DEFAULT true,
    "allowed_dimensions" "ledger_dimension"[],
    "required_dimensions" "ledger_dimension"[],
    "cash_flow_class" "cash_flow_class" NOT NULL,
    "status" "account_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_accounts" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_changes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "account_id" BIGINT,
    "kind" "account_change_kind" NOT NULL,
    "proposed" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "config_version_status" NOT NULL DEFAULT 'proposed',
    "approval_request_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_account_changes" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_centres" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "account_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,

    CONSTRAINT "pk_cost_centres" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "entry_no" TEXT,
    "jv_number" TEXT,
    "fiscal_period_id" BIGINT NOT NULL,
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
    "approval_request_id" BIGINT,
    "rejection_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "approved_at" TIMESTAMPTZ(6),
    "approved_by" BIGINT,
    "posted_at" TIMESTAMPTZ(6),
    "posted_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_journal_entries" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "journal_entry_id" BIGINT NOT NULL,
    "line_no" SMALLINT NOT NULL,
    "account_id" BIGINT NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "order_id" BIGINT,
    "order_group_id" BIGINT,
    "customer_user_id" BIGINT,
    "company_id" BIGINT,
    "factory_id" BIGINT,
    "vendor_id" BIGINT,
    "product_type_id" BIGINT,
    "channel" "sales_channel",
    "campaign_id" BIGINT,
    "promotion_id" BIGINT,
    "cost_centre_id" BIGINT,
    "tax_code" "tax_code",
    "tax_base_amount" DECIMAL(14,2),
    "entity_id" BIGINT NOT NULL,
    "fiscal_period_id" BIGINT NOT NULL,
    "entry_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_journal_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posting_rules" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "decision_refs" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,

    CONSTRAINT "pk_posting_rules" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posting_rule_versions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "posting_rule_id" BIGINT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "status" "config_version_status" NOT NULL DEFAULT 'draft',
    "conditions" JSONB,
    "template" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "approval_request_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" BIGINT,

    CONSTRAINT "pk_posting_rule_versions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_journals" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "day_of_month" SMALLINT NOT NULL,
    "template" JSONB NOT NULL,
    "auto_reverse" BOOLEAN NOT NULL DEFAULT false,
    "start_on" DATE NOT NULL,
    "end_on" DATE,
    "next_run_on" DATE NOT NULL,
    "status" "recurring_journal_status" NOT NULL DEFAULT 'pending_approval',
    "approval_request_id" BIGINT,
    "approved_at" TIMESTAMPTZ(6),
    "approved_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_recurring_journals" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entry_counters" (
    "entity_id" BIGINT NOT NULL,
    "period_key" TEXT NOT NULL,
    "next_value" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_journal_entry_counters" PRIMARY KEY ("entity_id","period_key")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_fiscal_years__public_id" ON "fiscal_years"("public_id");

-- CreateIndex
CREATE INDEX "ix_fiscal_years__created_by" ON "fiscal_years"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_fiscal_years__entity_id__start_date" ON "fiscal_years"("entity_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "ux_fiscal_periods__public_id" ON "fiscal_periods"("public_id");

-- CreateIndex
CREATE INDEX "ix_fiscal_periods__status_changed_by" ON "fiscal_periods"("status_changed_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_fiscal_periods__entity_id__start_date" ON "fiscal_periods"("entity_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "ux_fiscal_periods__fiscal_year_id__period_no" ON "fiscal_periods"("fiscal_year_id", "period_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_accounts__public_id" ON "accounts"("public_id");

-- CreateIndex
CREATE INDEX "ix_accounts__parent_id" ON "accounts"("parent_id");

-- CreateIndex
CREATE INDEX "ix_accounts__created_by" ON "accounts"("created_by");

-- CreateIndex
CREATE INDEX "ix_accounts__updated_by" ON "accounts"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_accounts__entity_id__code" ON "accounts"("entity_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ux_account_changes__public_id" ON "account_changes"("public_id");

-- CreateIndex
CREATE INDEX "ix_account_changes__entity_id" ON "account_changes"("entity_id");

-- CreateIndex
CREATE INDEX "ix_account_changes__account_id" ON "account_changes"("account_id");

-- CreateIndex
CREATE INDEX "ix_account_changes__approval_request_id" ON "account_changes"("approval_request_id");

-- CreateIndex
CREATE INDEX "ix_account_changes__created_by" ON "account_changes"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_cost_centres__public_id" ON "cost_centres"("public_id");

-- CreateIndex
CREATE INDEX "ix_cost_centres__created_by" ON "cost_centres"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_cost_centres__entity_id__code" ON "cost_centres"("entity_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ux_journal_entries__public_id" ON "journal_entries"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_journal_entries__reverses_entry_id" ON "journal_entries"("reverses_entry_id");

-- CreateIndex
CREATE INDEX "ix_journal_entries__fiscal_period_id__status" ON "journal_entries"("fiscal_period_id", "status");

-- CreateIndex
CREATE INDEX "ix_journal_entries__entity_id__entry_date" ON "journal_entries"("entity_id", "entry_date");

-- CreateIndex
CREATE INDEX "ix_journal_entries__source_document" ON "journal_entries"("source_document_type", "source_document_public_id");

-- CreateIndex
CREATE INDEX "ix_journal_entries__posting_rule_id" ON "journal_entries"("posting_rule_id");

-- CreateIndex
CREATE INDEX "ix_journal_entries__posting_rule_version_id" ON "journal_entries"("posting_rule_version_id");

-- CreateIndex
CREATE INDEX "ix_journal_entries__recurring_journal_id" ON "journal_entries"("recurring_journal_id");

-- CreateIndex
CREATE INDEX "ix_journal_entries__approval_request_id" ON "journal_entries"("approval_request_id");

-- CreateIndex
CREATE INDEX "ix_journal_entries__created_by" ON "journal_entries"("created_by");

-- CreateIndex
CREATE INDEX "ix_journal_entries__approved_by" ON "journal_entries"("approved_by");

-- CreateIndex
CREATE INDEX "ix_journal_entries__posted_by" ON "journal_entries"("posted_by");

-- CreateIndex
CREATE INDEX "ix_journal_entries__auto_reverse_on" ON "journal_entries"("auto_reverse_on") WHERE (auto_reverse_on IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "ux_journal_entries__entity_id__entry_no" ON "journal_entries"("entity_id", "entry_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_journal_entries__domain_event_id__posting_rule_id" ON "journal_entries"("domain_event_id", "posting_rule_id") WHERE (domain_event_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "ix_journal_lines__account_id__entry_date" ON "journal_lines"("account_id", "entry_date");

-- CreateIndex
CREATE INDEX "ix_journal_lines__entity_id__fiscal_period_id__account_id" ON "journal_lines"("entity_id", "fiscal_period_id", "account_id");

-- CreateIndex
CREATE INDEX "ix_journal_lines__fiscal_period_id" ON "journal_lines"("fiscal_period_id");

-- CreateIndex
CREATE INDEX "ix_journal_lines__order_id" ON "journal_lines"("order_id") WHERE (order_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "ix_journal_lines__order_group_id" ON "journal_lines"("order_group_id") WHERE (order_group_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "ix_journal_lines__customer_user_id" ON "journal_lines"("customer_user_id") WHERE (customer_user_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "ix_journal_lines__company_id" ON "journal_lines"("company_id") WHERE (company_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "ix_journal_lines__factory_id" ON "journal_lines"("factory_id") WHERE (factory_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "ix_journal_lines__vendor_id" ON "journal_lines"("vendor_id") WHERE (vendor_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "ix_journal_lines__product_type_id" ON "journal_lines"("product_type_id") WHERE (product_type_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "ix_journal_lines__campaign_id" ON "journal_lines"("campaign_id") WHERE (campaign_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "ix_journal_lines__promotion_id" ON "journal_lines"("promotion_id") WHERE (promotion_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "ix_journal_lines__cost_centre_id" ON "journal_lines"("cost_centre_id") WHERE (cost_centre_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "ix_journal_lines__tax_code__entry_date" ON "journal_lines"("tax_code", "entry_date") WHERE (tax_code IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "ux_journal_lines__journal_entry_id__line_no" ON "journal_lines"("journal_entry_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_posting_rules__public_id" ON "posting_rules"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_posting_rules__key" ON "posting_rules"("key");

-- CreateIndex
CREATE INDEX "ix_posting_rules__event_type" ON "posting_rules"("event_type");

-- CreateIndex
CREATE INDEX "ix_posting_rules__created_by" ON "posting_rules"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_posting_rule_versions__public_id" ON "posting_rule_versions"("public_id");

-- CreateIndex
CREATE INDEX "ix_posting_rule_versions__resolution" ON "posting_rule_versions"("posting_rule_id", "effective_from" DESC, "version_no" DESC) WHERE (status = 'approved'::config_version_status);

-- CreateIndex
CREATE INDEX "ix_posting_rule_versions__approval_request_id" ON "posting_rule_versions"("approval_request_id");

-- CreateIndex
CREATE INDEX "ix_posting_rule_versions__created_by" ON "posting_rule_versions"("created_by");

-- CreateIndex
CREATE INDEX "ix_posting_rule_versions__decided_by" ON "posting_rule_versions"("decided_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_posting_rule_versions__posting_rule_id__version_no" ON "posting_rule_versions"("posting_rule_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_recurring_journals__public_id" ON "recurring_journals"("public_id");

-- CreateIndex
CREATE INDEX "ix_recurring_journals__status__next_run_on" ON "recurring_journals"("status", "next_run_on");

-- CreateIndex
CREATE INDEX "ix_recurring_journals__entity_id" ON "recurring_journals"("entity_id");

-- CreateIndex
CREATE INDEX "ix_recurring_journals__approval_request_id" ON "recurring_journals"("approval_request_id");

-- CreateIndex
CREATE INDEX "ix_recurring_journals__approved_by" ON "recurring_journals"("approved_by");

-- CreateIndex
CREATE INDEX "ix_recurring_journals__created_by" ON "recurring_journals"("created_by");

-- AddForeignKey
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fk_fiscal_years__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fk_fiscal_years__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fk_fiscal_periods__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fk_fiscal_periods__fiscal_year_id" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fk_fiscal_periods__status_changed_by" FOREIGN KEY ("status_changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "fk_accounts__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "fk_accounts__parent_id" FOREIGN KEY ("parent_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "fk_accounts__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "fk_accounts__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "account_changes" ADD CONSTRAINT "fk_account_changes__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "account_changes" ADD CONSTRAINT "fk_account_changes__account_id" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "account_changes" ADD CONSTRAINT "fk_account_changes__approval_request_id" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "account_changes" ADD CONSTRAINT "fk_account_changes__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "cost_centres" ADD CONSTRAINT "fk_cost_centres__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "cost_centres" ADD CONSTRAINT "fk_cost_centres__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "fk_journal_entries__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "fk_journal_entries__fiscal_period_id" FOREIGN KEY ("fiscal_period_id") REFERENCES "fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "fk_journal_entries__domain_event_id" FOREIGN KEY ("domain_event_id") REFERENCES "domain_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "fk_journal_entries__posting_rule_id" FOREIGN KEY ("posting_rule_id") REFERENCES "posting_rules"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "fk_journal_entries__posting_rule_version_id" FOREIGN KEY ("posting_rule_version_id") REFERENCES "posting_rule_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "fk_journal_entries__reverses_entry_id" FOREIGN KEY ("reverses_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "fk_journal_entries__recurring_journal_id" FOREIGN KEY ("recurring_journal_id") REFERENCES "recurring_journals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "fk_journal_entries__approval_request_id" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "fk_journal_entries__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "fk_journal_entries__approved_by" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "fk_journal_entries__posted_by" FOREIGN KEY ("posted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines__journal_entry_id" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines__account_id" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines__order_group_id" FOREIGN KEY ("order_group_id") REFERENCES "order_groups"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines__vendor_id" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines__product_type_id" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines__campaign_id" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines__promotion_id" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines__cost_centre_id" FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centres"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "fk_journal_lines__fiscal_period_id" FOREIGN KEY ("fiscal_period_id") REFERENCES "fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "posting_rules" ADD CONSTRAINT "fk_posting_rules__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "posting_rule_versions" ADD CONSTRAINT "fk_posting_rule_versions__posting_rule_id" FOREIGN KEY ("posting_rule_id") REFERENCES "posting_rules"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "posting_rule_versions" ADD CONSTRAINT "fk_posting_rule_versions__approval_request_id" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "posting_rule_versions" ADD CONSTRAINT "fk_posting_rule_versions__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "posting_rule_versions" ADD CONSTRAINT "fk_posting_rule_versions__decided_by" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "recurring_journals" ADD CONSTRAINT "fk_recurring_journals__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "recurring_journals" ADD CONSTRAINT "fk_recurring_journals__approval_request_id" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "recurring_journals" ADD CONSTRAINT "fk_recurring_journals__approved_by" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "recurring_journals" ADD CONSTRAINT "fk_recurring_journals__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "journal_entry_counters" ADD CONSTRAINT "fk_journal_entry_counters__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- =====================================================================================================
-- Hand-written: ledger core (accounting-design.md §1, §3, §4; schema-design §3.8, A-41; ADR-0007)
-- =====================================================================================================

-- --- fiscal years & periods (§1.4) ------------------------------------------------------------------
ALTER TABLE fiscal_years
  ADD CONSTRAINT ck_fiscal_years__dates CHECK (end_date >= start_date),
  ADD CONSTRAINT ck_fiscal_years__label CHECK (btrim(label) <> '');
ALTER TABLE fiscal_years ADD CONSTRAINT ex_fiscal_years__no_overlap
  EXCLUDE USING gist (entity_id WITH =, daterange(start_date, end_date, '[]') WITH &&);
CREATE TRIGGER tg_fiscal_years__no_delete BEFORE DELETE ON fiscal_years
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE fiscal_periods
  ADD CONSTRAINT ck_fiscal_periods__dates CHECK (end_date >= start_date),
  ADD CONSTRAINT ck_fiscal_periods__period_no CHECK (period_no BETWEEN 1 AND 13),
  ADD CONSTRAINT ck_fiscal_periods__status_changed CHECK (status = 'open' OR status_changed_at IS NOT NULL);
ALTER TABLE fiscal_periods ADD CONSTRAINT ex_fiscal_periods__no_overlap
  EXCLUDE USING gist (entity_id WITH =, daterange(start_date, end_date, '[]') WITH &&);
-- Dates never move; a locked period (auditor sign-off, §7 step 9) never reopens; periods are never deleted.
CREATE FUNCTION tg_fiscal_periods__guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fiscal periods are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.entity_id <> OLD.entity_id OR NEW.fiscal_year_id <> OLD.fiscal_year_id OR NEW.period_no <> OLD.period_no
     OR NEW.start_date <> OLD.start_date OR NEW.end_date <> OLD.end_date THEN
    RAISE EXCEPTION 'fiscal period % cannot move', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'locked' AND NEW.status <> 'locked' THEN
    RAISE EXCEPTION 'fiscal period % is locked', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_fiscal_periods__guard BEFORE UPDATE OR DELETE ON fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION tg_fiscal_periods__guard();

-- --- chart of accounts (§3) ---------------------------------------------------------------------------
ALTER TABLE accounts
  ADD CONSTRAINT ck_accounts__code CHECK (code ~ '^[0-9A-Z][0-9A-Z.-]*$'),
  ADD CONSTRAINT ck_accounts__names CHECK (btrim(name_th) <> '' AND btrim(name_en) <> ''),
  ADD CONSTRAINT ck_accounts__required_allowed CHECK (required_dimensions <@ allowed_dimensions),
  ADD CONSTRAINT ck_accounts__not_own_parent CHECK (parent_id IS NULL OR parent_id <> id);
CREATE TRIGGER tg_accounts__no_delete BEFORE DELETE ON accounts
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE account_changes
  ADD CONSTRAINT ck_account_changes__reason CHECK (btrim(reason) <> ''),
  ADD CONSTRAINT ck_account_changes__target CHECK ((kind = 'create') = (account_id IS NULL)),
  ADD CONSTRAINT ck_account_changes__status CHECK (status IN ('proposed', 'approved', 'rejected', 'withdrawn')),
  ADD CONSTRAINT ck_account_changes__decided CHECK (status = 'proposed' OR decided_at IS NOT NULL);
CREATE TRIGGER tg_account_changes__immutable BEFORE UPDATE OR DELETE ON account_changes
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_version_change();

ALTER TABLE cost_centres
  ADD CONSTRAINT ck_cost_centres__code CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]*$'),
  ADD CONSTRAINT ck_cost_centres__name CHECK (btrim(name) <> '');

-- --- journals (§1.2 immutable, balanced; §1.4 period discipline; §3 control accounts) ---------------
ALTER TABLE journal_entries
  ADD CONSTRAINT ck_journal_entries__description CHECK (btrim(description) <> ''),
  ADD CONSTRAINT ck_journal_entries__totals CHECK (total_debit >= 0 AND total_credit >= 0),
  ADD CONSTRAINT ck_journal_entries__posted CHECK (
    status <> 'posted' OR (entry_no IS NOT NULL AND posted_at IS NOT NULL
                           AND total_debit = total_credit AND total_debit > 0)),
  ADD CONSTRAINT ck_journal_entries__rejected CHECK (status <> 'rejected' OR btrim(coalesce(rejection_reason, '')) <> ''),
  ADD CONSTRAINT ck_journal_entries__auto CHECK (kind <> 'auto' OR (posting_rule_version_id IS NOT NULL AND posting_rule_id IS NOT NULL)),
  ADD CONSTRAINT ck_journal_entries__reversal CHECK ((kind = 'reversal') = (reverses_entry_id IS NOT NULL)),
  ADD CONSTRAINT ck_journal_entries__manual CHECK (kind NOT IN ('manual', 'recurring') OR domain_event_id IS NULL),
  ADD CONSTRAINT ck_journal_entries__recurring CHECK ((kind = 'recurring') = (recurring_journal_id IS NOT NULL)),
  ADD CONSTRAINT ck_journal_entries__source CHECK ((source_document_type IS NULL) = (source_document_public_id IS NULL));

-- Posted and rejected entries never change and are never deleted (§1.2).
CREATE FUNCTION tg_journal_entries__guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('posted', 'rejected') THEN
    RAISE EXCEPTION 'journal entry % is % and cannot be changed', OLD.id, OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_journal_entries__guard BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION tg_journal_entries__guard();

-- Posting needs an open period of the entry's entity that contains the entry date; a soft-closed period
-- only when the posting session set `packio.post_soft_closed` (permission `ledger.post_soft_closed`).
CREATE FUNCTION tg_journal_entries__period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p fiscal_periods%ROWTYPE;
BEGIN
  IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
  SELECT * INTO p FROM fiscal_periods WHERE id = NEW.fiscal_period_id;
  IF p.entity_id <> NEW.entity_id OR NEW.entry_date NOT BETWEEN p.start_date AND p.end_date THEN
    RAISE EXCEPTION 'entry date % is outside fiscal period %', NEW.entry_date, p.id USING ERRCODE = 'check_violation';
  END IF;
  IF p.status = 'open' OR (p.status = 'soft_closed' AND current_setting('packio.post_soft_closed', true) = 'on') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ledger.period_closed: fiscal period % is %', p.id, p.status USING ERRCODE = 'restrict_violation';
END
$$;
CREATE TRIGGER tg_journal_entries__period BEFORE INSERT OR UPDATE OF status ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION tg_journal_entries__period();

-- At commit: a posted entry has ≥ 2 lines that balance and match its totals, on active postable accounts of
-- its entity, with the account's required dimensions and no dimension the account does not allow; control
-- accounts only from sub-ledger (automatic) entries or their reversals (§3).
CREATE FUNCTION tg_journal_entries__balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  n integer;
  dr numeric(14, 2);
  cr numeric(14, 2);
  bad text;
  from_sub_ledger boolean;
BEGIN
  IF NEW.status <> 'posted' THEN RETURN NULL; END IF;
  SELECT count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0) INTO n, dr, cr
    FROM journal_lines WHERE journal_entry_id = NEW.id;
  IF n < 2 OR dr <> cr OR dr <> NEW.total_debit OR cr <> NEW.total_credit THEN
    RAISE EXCEPTION 'ledger.unbalanced: journal entry % has % lines, debit %, credit % (totals %/%)',
      NEW.id, n, dr, cr, NEW.total_debit, NEW.total_credit USING ERRCODE = 'check_violation';
  END IF;
  from_sub_ledger := NEW.kind = 'auto' OR (NEW.kind = 'reversal' AND EXISTS (
    SELECT 1 FROM journal_entries r WHERE r.id = NEW.reverses_entry_id AND r.kind = 'auto'));
  SELECT a.code INTO bad
    FROM journal_lines l JOIN accounts a ON a.id = l.account_id
   WHERE l.journal_entry_id = NEW.id AND (
         a.entity_id <> NEW.entity_id OR a.status <> 'active' OR NOT a.is_postable
      OR (a.is_control AND NOT from_sub_ledger)
      OR (array_remove(ARRAY[
            CASE WHEN l.order_id IS NOT NULL THEN 'order' END,
            CASE WHEN l.order_group_id IS NOT NULL THEN 'order_group' END,
            CASE WHEN l.customer_user_id IS NOT NULL THEN 'customer' END,
            CASE WHEN l.company_id IS NOT NULL THEN 'company' END,
            CASE WHEN l.factory_id IS NOT NULL THEN 'factory' END,
            CASE WHEN l.vendor_id IS NOT NULL THEN 'vendor' END,
            CASE WHEN l.product_type_id IS NOT NULL THEN 'product_type' END,
            CASE WHEN l.channel IS NOT NULL THEN 'channel' END,
            CASE WHEN l.campaign_id IS NOT NULL THEN 'campaign' END,
            CASE WHEN l.promotion_id IS NOT NULL THEN 'promotion' END,
            CASE WHEN l.cost_centre_id IS NOT NULL THEN 'cost_centre' END], NULL)::ledger_dimension[]
          <@ a.allowed_dimensions) IS NOT TRUE
      OR (a.required_dimensions <@ array_remove(ARRAY[
            CASE WHEN l.order_id IS NOT NULL THEN 'order' END,
            CASE WHEN l.order_group_id IS NOT NULL THEN 'order_group' END,
            CASE WHEN l.customer_user_id IS NOT NULL THEN 'customer' END,
            CASE WHEN l.company_id IS NOT NULL THEN 'company' END,
            CASE WHEN l.factory_id IS NOT NULL THEN 'factory' END,
            CASE WHEN l.vendor_id IS NOT NULL THEN 'vendor' END,
            CASE WHEN l.product_type_id IS NOT NULL THEN 'product_type' END,
            CASE WHEN l.channel IS NOT NULL THEN 'channel' END,
            CASE WHEN l.campaign_id IS NOT NULL THEN 'campaign' END,
            CASE WHEN l.promotion_id IS NOT NULL THEN 'promotion' END,
            CASE WHEN l.cost_centre_id IS NOT NULL THEN 'cost_centre' END], NULL)::ledger_dimension[]) IS NOT TRUE)
   LIMIT 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'ledger.account_rule: journal entry % breaks the rules of account %', NEW.id, bad
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER tg_journal_entries__balanced AFTER INSERT OR UPDATE ON journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.status = 'posted')
  EXECUTE FUNCTION tg_journal_entries__balanced();

ALTER TABLE journal_lines
  ADD CONSTRAINT ck_journal_lines__sides CHECK (debit >= 0 AND credit >= 0 AND (debit = 0) <> (credit = 0)),
  ADD CONSTRAINT ck_journal_lines__line_no CHECK (line_no > 0),
  ADD CONSTRAINT ck_journal_lines__tax CHECK (tax_base_amount IS NULL OR tax_code IS NOT NULL);
-- Lines belong to an entry that is still being written; posted lines never change. The reporting columns
-- are copied from the entry.
CREATE FUNCTION tg_journal_lines__guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  e journal_entries%ROWTYPE;
BEGIN
  SELECT * INTO e FROM journal_entries WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.journal_entry_id ELSE NEW.journal_entry_id END;
  IF e.status IN ('posted', 'rejected') THEN
    RAISE EXCEPTION 'lines of journal entry % are frozen (%)', e.id, e.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  NEW.entity_id := e.entity_id;
  NEW.fiscal_period_id := e.fiscal_period_id;
  NEW.entry_date := e.entry_date;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_journal_lines__guard BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION tg_journal_lines__guard();
-- Posting the entry refreshes the lines' copy of its period and date (they may move to the next open period).
CREATE FUNCTION tg_journal_entries__sync_lines() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.fiscal_period_id IS DISTINCT FROM OLD.fiscal_period_id OR NEW.entry_date IS DISTINCT FROM OLD.entry_date THEN
    UPDATE journal_lines SET fiscal_period_id = NEW.fiscal_period_id, entry_date = NEW.entry_date
     WHERE journal_entry_id = NEW.id;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER tg_journal_entries__sync_lines AFTER UPDATE OF fiscal_period_id, entry_date ON journal_entries
  FOR EACH ROW WHEN (NEW.status NOT IN ('posted', 'rejected'))
  EXECUTE FUNCTION tg_journal_entries__sync_lines();

-- --- posting rules (ADR-0007; changes via `posting_rule_change`, §8) --------------------------------
ALTER TABLE posting_rules
  ADD CONSTRAINT ck_posting_rules__key CHECK (key ~ '^[A-Z]{1,3}[0-9]{2}[A-Z]?$'),
  ADD CONSTRAINT ck_posting_rules__event_type CHECK (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  ADD CONSTRAINT ck_posting_rules__decision_refs CHECK (cardinality(decision_refs) >= 1);
ALTER TABLE posting_rule_versions
  ADD CONSTRAINT ck_posting_rule_versions__version_no CHECK (version_no > 0),
  ADD CONSTRAINT ck_posting_rule_versions__reason CHECK (btrim(reason) <> ''),
  ADD CONSTRAINT ck_posting_rule_versions__decided CHECK (status NOT IN ('approved', 'rejected') OR decided_at IS NOT NULL),
  ADD CONSTRAINT ck_posting_rule_versions__status CHECK (status <> 'pending_acceptance'),
  ADD CONSTRAINT ck_posting_rule_versions__template CHECK (jsonb_typeof(template) = 'object' AND jsonb_typeof(template -> 'lines') = 'array');
CREATE TRIGGER tg_posting_rule_versions__immutable BEFORE UPDATE OR DELETE ON posting_rule_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_version_change();

-- --- recurring journals & counters -----------------------------------------------------------------
ALTER TABLE recurring_journals
  ADD CONSTRAINT ck_recurring_journals__day_of_month CHECK (day_of_month BETWEEN 1 AND 28),
  ADD CONSTRAINT ck_recurring_journals__window CHECK (end_on IS NULL OR end_on >= start_on),
  ADD CONSTRAINT ck_recurring_journals__name CHECK (btrim(name) <> ''),
  ADD CONSTRAINT ck_recurring_journals__template CHECK (jsonb_typeof(template -> 'lines') = 'array'),
  ADD CONSTRAINT ck_recurring_journals__approved CHECK (status IN ('pending_approval', 'rejected') OR approved_at IS NOT NULL);
ALTER TABLE journal_entry_counters
  ADD CONSTRAINT ck_journal_entry_counters__next_value CHECK (next_value > 0);
