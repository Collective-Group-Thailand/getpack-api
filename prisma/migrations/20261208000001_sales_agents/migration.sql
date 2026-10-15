-- D-416 – D-423: the sales agent programme — agents (customer accounts with an agent profile), applications,
-- commission plans and their versions, customer/company links, leads, factory links, the commission
-- ledger and monthly statements; commission withholding (s.40(2), ภ.ง.ด.1) and the agent agreement.

-- AlterEnum
ALTER TYPE "vendor_kind" ADD VALUE 'sales_agent';

-- AlterEnum
ALTER TYPE "wht_category" ADD VALUE 'commission';

-- AlterEnum
ALTER TYPE "wht_form" ADD VALUE 'pnd1';

-- AlterEnum
ALTER TYPE "tax_report_kind" ADD VALUE 'pnd1';

-- AlterEnum
ALTER TYPE "tax_code" ADD VALUE 'wht_pnd1';

-- CreateEnum
CREATE TYPE "sales_agent_kind" AS ENUM ('freelance', 'employee');

-- CreateEnum
CREATE TYPE "sales_agent_status" AS ENUM ('active', 'suspended', 'ended');

-- CreateEnum
CREATE TYPE "sales_agent_application_status" AS ENUM ('submitted', 'approved', 'rejected', 'withdrawn');

-- CreateEnum
CREATE TYPE "sales_agent_link_source" AS ENUM ('link', 'lead', 'staff', 'company');

-- CreateEnum
CREATE TYPE "sales_agent_link_status" AS ENUM ('active', 'ended');

-- CreateEnum
CREATE TYPE "sales_agent_lead_kind" AS ENUM ('customer', 'factory');

-- CreateEnum
CREATE TYPE "sales_agent_lead_status" AS ENUM ('registered', 'converted', 'expired', 'rejected', 'withdrawn');

-- CreateEnum
CREATE TYPE "sales_agent_factory_link_status" AS ENUM ('pending', 'qualified', 'expired', 'ended');

-- CreateEnum
CREATE TYPE "sales_agent_commission_kind" AS ENUM ('order', 'factory_bounty', 'adjustment', 'reversal');

-- CreateEnum
CREATE TYPE "sales_agent_commission_status" AS ENUM ('pending', 'held', 'earned', 'statemented', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "sales_agent_statement_status" AS ENUM ('draft', 'approved', 'exported', 'paid', 'voided');

-- CreateEnum
CREATE TYPE "agreement_party" AS ENUM ('factory', 'sales_agent');

-- AlterTable
ALTER TABLE "payable_items" ADD COLUMN     "wht_base_commission" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "agreement_templates" ADD COLUMN     "party" "agreement_party" NOT NULL DEFAULT 'factory';

-- CreateTable
CREATE TABLE "sales_agent_plans" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT,
    "description" TEXT,
    "agent_kind" "sales_agent_kind" NOT NULL,
    "retired_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_sales_agent_plans" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_agent_plan_versions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "plan_id" BIGINT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "status" "config_version_status" NOT NULL DEFAULT 'draft',
    "first_order_pct" DECIMAL(7,4) NOT NULL,
    "repeat_order_pct" DECIMAL(7,4) NOT NULL,
    "attribution_months" SMALLINT NOT NULL,
    "margin_cap_pct" DECIMAL(7,4) NOT NULL,
    "min_base_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "factory_bounty_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "factory_qualify_jobs" SMALLINT NOT NULL DEFAULT 0,
    "factory_qualify_days" SMALLINT NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" BIGINT,
    "decision_note" TEXT,

    CONSTRAINT "pk_sales_agent_plan_versions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_agent_applications" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" BIGINT NOT NULL,
    "status" "sales_agent_application_status" NOT NULL DEFAULT 'submitted',
    "juristic_type" "juristic_type" NOT NULL,
    "legal_name" TEXT NOT NULL,
    "tax_id" CHAR(13) NOT NULL,
    "branch_code" CHAR(5) NOT NULL DEFAULT '00000',
    "is_vat_registered" BOOLEAN NOT NULL DEFAULT false,
    "address" TEXT NOT NULL,
    "postcode" CHAR(5) NOT NULL,
    "pitch" TEXT,
    "id_document_file_id" BIGINT NOT NULL,
    "bank_code" TEXT NOT NULL,
    "bank_branch_name" TEXT,
    "bank_account_name" TEXT NOT NULL,
    "bank_account_no_enc" BYTEA NOT NULL,
    "bank_account_no_last4" CHAR(4) NOT NULL,
    "bank_book_file_id" BIGINT,
    "agreement_version_id" BIGINT NOT NULL,
    "agreement_accepted_at" TIMESTAMPTZ(6) NOT NULL,
    "agreement_evidence_sha256" BYTEA NOT NULL,
    "ip" INET,
    "user_agent" TEXT,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" BIGINT,
    "decision_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_sales_agent_applications" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_agents" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" BIGINT NOT NULL,
    "kind" "sales_agent_kind" NOT NULL,
    "status" "sales_agent_status" NOT NULL DEFAULT 'active',
    "code" TEXT NOT NULL,
    "plan_id" BIGINT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "juristic_type" "juristic_type" NOT NULL DEFAULT 'individual',
    "tax_id" CHAR(13),
    "vendor_id" BIGINT,
    "employee_code" TEXT,
    "staff_user_id" BIGINT,
    "application_id" BIGINT,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suspended_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "status_reason" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_sales_agents" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_agent_links" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "agent_id" BIGINT NOT NULL,
    "customer_user_id" BIGINT,
    "company_id" BIGINT,
    "source" "sales_agent_link_source" NOT NULL,
    "lead_id" BIGINT,
    "parent_link_id" BIGINT,
    "status" "sales_agent_link_status" NOT NULL DEFAULT 'active',
    "attributed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "ended_reason" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_sales_agent_links" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_agent_leads" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "agent_id" BIGINT NOT NULL,
    "kind" "sales_agent_lead_kind" NOT NULL,
    "status" "sales_agent_lead_status" NOT NULL DEFAULT 'registered',
    "contact_name" TEXT NOT NULL,
    "organisation_name" TEXT,
    "phone" TEXT,
    "email" CITEXT,
    "tax_id" CHAR(13),
    "note" TEXT,
    "protected_until" TIMESTAMPTZ(6) NOT NULL,
    "converted_at" TIMESTAMPTZ(6),
    "converted_user_id" BIGINT,
    "converted_company_id" BIGINT,
    "converted_factory_id" BIGINT,
    "closed_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_sales_agent_leads" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_agent_factory_links" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "agent_id" BIGINT NOT NULL,
    "factory_id" BIGINT NOT NULL,
    "lead_id" BIGINT,
    "status" "sales_agent_factory_link_status" NOT NULL DEFAULT 'pending',
    "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "qualified_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "reason" TEXT,

    CONSTRAINT "pk_sales_agent_factory_links" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_agent_commissions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "agent_id" BIGINT NOT NULL,
    "kind" "sales_agent_commission_kind" NOT NULL,
    "status" "sales_agent_commission_status" NOT NULL DEFAULT 'pending',
    "link_id" BIGINT,
    "factory_link_id" BIGINT,
    "order_id" BIGINT,
    "order_group_id" BIGINT,
    "plan_version_id" BIGINT,
    "is_first_order" BOOLEAN NOT NULL DEFAULT false,
    "base_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "rate_pct" DECIMAL(7,4),
    "margin_amount" DECIMAL(14,2),
    "cap_amount" DECIMAL(14,2),
    "amount" DECIMAL(14,2) NOT NULL,
    "available_at" TIMESTAMPTZ(6),
    "earned_at" TIMESTAMPTZ(6),
    "statement_id" BIGINT,
    "reverses_commission_id" BIGINT,
    "hold_flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_sales_agent_commissions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_agent_statements" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "statement_no" TEXT NOT NULL,
    "agent_id" BIGINT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" "sales_agent_statement_status" NOT NULL DEFAULT 'draft',
    "entry_count" INTEGER NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "vendor_invoice_id" BIGINT,
    "approved_at" TIMESTAMPTZ(6),
    "approved_by" BIGINT,
    "exported_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "voided_at" TIMESTAMPTZ(6),
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_sales_agent_statements" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_plans__public_id" ON "sales_agent_plans"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_plans__code" ON "sales_agent_plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_plan_versions__public_id" ON "sales_agent_plan_versions"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_plan_versions__plan_id__version_no" ON "sales_agent_plan_versions"("plan_id", "version_no");

-- CreateIndex
CREATE INDEX "ix_sales_agent_plan_versions__plan_id__status__effective_from" ON "sales_agent_plan_versions"("plan_id", "status", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_applications__public_id" ON "sales_agent_applications"("public_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_applications__user_id" ON "sales_agent_applications"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_applications__user_id__submitted" ON "sales_agent_applications"("user_id") WHERE (status = 'submitted'::sales_agent_application_status);

-- CreateIndex
CREATE INDEX "ix_sales_agent_applications__status__submitted_at" ON "sales_agent_applications"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "ix_sales_agent_applications__id_document_file_id" ON "sales_agent_applications"("id_document_file_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_applications__bank_book_file_id" ON "sales_agent_applications"("bank_book_file_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_applications__agreement_version_id" ON "sales_agent_applications"("agreement_version_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_applications__decided_by" ON "sales_agent_applications"("decided_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agents__public_id" ON "sales_agents"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agents__user_id" ON "sales_agents"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agents__code" ON "sales_agents"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agents__vendor_id" ON "sales_agents"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agents__application_id" ON "sales_agents"("application_id");

-- CreateIndex
CREATE INDEX "ix_sales_agents__status__kind" ON "sales_agents"("status", "kind");

-- CreateIndex
CREATE INDEX "ix_sales_agents__plan_id" ON "sales_agents"("plan_id");

-- CreateIndex
CREATE INDEX "ix_sales_agents__staff_user_id" ON "sales_agents"("staff_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_links__public_id" ON "sales_agent_links"("public_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_links__agent_id__status" ON "sales_agent_links"("agent_id", "status");

-- CreateIndex
CREATE INDEX "ix_sales_agent_links__customer_user_id" ON "sales_agent_links"("customer_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_links__customer_user_id__active" ON "sales_agent_links"("customer_user_id") WHERE (status = 'active'::sales_agent_link_status);

-- CreateIndex
CREATE INDEX "ix_sales_agent_links__company_id" ON "sales_agent_links"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_links__company_id__active" ON "sales_agent_links"("company_id") WHERE (status = 'active'::sales_agent_link_status);

-- CreateIndex
CREATE INDEX "ix_sales_agent_links__lead_id" ON "sales_agent_links"("lead_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_links__parent_link_id" ON "sales_agent_links"("parent_link_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_leads__public_id" ON "sales_agent_leads"("public_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_leads__agent_id__status" ON "sales_agent_leads"("agent_id", "status");

-- CreateIndex
CREATE INDEX "ix_sales_agent_leads__phone__registered" ON "sales_agent_leads"("phone") WHERE (status = 'registered'::sales_agent_lead_status);

-- CreateIndex
CREATE INDEX "ix_sales_agent_leads__email__registered" ON "sales_agent_leads"("email") WHERE (status = 'registered'::sales_agent_lead_status);

-- CreateIndex
CREATE INDEX "ix_sales_agent_leads__tax_id__registered" ON "sales_agent_leads"("tax_id") WHERE (status = 'registered'::sales_agent_lead_status);

-- CreateIndex
CREATE INDEX "ix_sales_agent_leads__converted_user_id" ON "sales_agent_leads"("converted_user_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_leads__converted_company_id" ON "sales_agent_leads"("converted_company_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_leads__converted_factory_id" ON "sales_agent_leads"("converted_factory_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_factory_links__public_id" ON "sales_agent_factory_links"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_factory_links__factory_id" ON "sales_agent_factory_links"("factory_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_factory_links__agent_id__status" ON "sales_agent_factory_links"("agent_id", "status");

-- CreateIndex
CREATE INDEX "ix_sales_agent_factory_links__lead_id" ON "sales_agent_factory_links"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_commissions__public_id" ON "sales_agent_commissions"("public_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_commissions__agent_id__status" ON "sales_agent_commissions"("agent_id", "status");

-- CreateIndex
CREATE INDEX "ix_sales_agent_commissions__status__available_at" ON "sales_agent_commissions"("status", "available_at");

-- CreateIndex
CREATE INDEX "ix_sales_agent_commissions__link_id" ON "sales_agent_commissions"("link_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_commissions__factory_link_id" ON "sales_agent_commissions"("factory_link_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_commissions__factory_link_id__bounty" ON "sales_agent_commissions"("factory_link_id") WHERE (kind = 'factory_bounty'::sales_agent_commission_kind);

-- CreateIndex
CREATE INDEX "ix_sales_agent_commissions__order_id" ON "sales_agent_commissions"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_commissions__order_id__order" ON "sales_agent_commissions"("order_id") WHERE (kind = 'order'::sales_agent_commission_kind);

-- CreateIndex
CREATE INDEX "ix_sales_agent_commissions__order_group_id" ON "sales_agent_commissions"("order_group_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_commissions__plan_version_id" ON "sales_agent_commissions"("plan_version_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_commissions__statement_id" ON "sales_agent_commissions"("statement_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_commissions__reverses_commission_id" ON "sales_agent_commissions"("reverses_commission_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_statements__public_id" ON "sales_agent_statements"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_statements__statement_no" ON "sales_agent_statements"("statement_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_statements__vendor_invoice_id" ON "sales_agent_statements"("vendor_invoice_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_statements__agent_id__period_start" ON "sales_agent_statements"("agent_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_statements__agent_id__period_start__live" ON "sales_agent_statements"("agent_id", "period_start") WHERE (status <> 'voided'::sales_agent_statement_status);

-- CreateIndex
CREATE INDEX "ix_sales_agent_statements__status__period_start" ON "sales_agent_statements"("status", "period_start");

-- CreateIndex
CREATE INDEX "ix_sales_agent_statements__entity_id" ON "sales_agent_statements"("entity_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_statements__approved_by" ON "sales_agent_statements"("approved_by");

-- AddForeignKey
ALTER TABLE "sales_agent_plan_versions" ADD CONSTRAINT "fk_sales_agent_plan_versions__plan_id" FOREIGN KEY ("plan_id") REFERENCES "sales_agent_plans"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_applications" ADD CONSTRAINT "fk_sales_agent_applications__user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_applications" ADD CONSTRAINT "fk_sales_agent_applications__id_document_file_id" FOREIGN KEY ("id_document_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_applications" ADD CONSTRAINT "fk_sales_agent_applications__bank_book_file_id" FOREIGN KEY ("bank_book_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_applications" ADD CONSTRAINT "fk_sales_agent_applications__agreement_version_id" FOREIGN KEY ("agreement_version_id") REFERENCES "agreement_template_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_applications" ADD CONSTRAINT "fk_sales_agent_applications__decided_by" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agents" ADD CONSTRAINT "fk_sales_agents__user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agents" ADD CONSTRAINT "fk_sales_agents__plan_id" FOREIGN KEY ("plan_id") REFERENCES "sales_agent_plans"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agents" ADD CONSTRAINT "fk_sales_agents__vendor_id" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agents" ADD CONSTRAINT "fk_sales_agents__staff_user_id" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agents" ADD CONSTRAINT "fk_sales_agents__application_id" FOREIGN KEY ("application_id") REFERENCES "sales_agent_applications"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_links" ADD CONSTRAINT "fk_sales_agent_links__agent_id" FOREIGN KEY ("agent_id") REFERENCES "sales_agents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_links" ADD CONSTRAINT "fk_sales_agent_links__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_links" ADD CONSTRAINT "fk_sales_agent_links__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_links" ADD CONSTRAINT "fk_sales_agent_links__lead_id" FOREIGN KEY ("lead_id") REFERENCES "sales_agent_leads"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_links" ADD CONSTRAINT "fk_sales_agent_links__parent_link_id" FOREIGN KEY ("parent_link_id") REFERENCES "sales_agent_links"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_leads" ADD CONSTRAINT "fk_sales_agent_leads__agent_id" FOREIGN KEY ("agent_id") REFERENCES "sales_agents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_leads" ADD CONSTRAINT "fk_sales_agent_leads__converted_user_id" FOREIGN KEY ("converted_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_leads" ADD CONSTRAINT "fk_sales_agent_leads__converted_company_id" FOREIGN KEY ("converted_company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_leads" ADD CONSTRAINT "fk_sales_agent_leads__converted_factory_id" FOREIGN KEY ("converted_factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_factory_links" ADD CONSTRAINT "fk_sales_agent_factory_links__agent_id" FOREIGN KEY ("agent_id") REFERENCES "sales_agents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_factory_links" ADD CONSTRAINT "fk_sales_agent_factory_links__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_factory_links" ADD CONSTRAINT "fk_sales_agent_factory_links__lead_id" FOREIGN KEY ("lead_id") REFERENCES "sales_agent_leads"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_commissions" ADD CONSTRAINT "fk_sales_agent_commissions__agent_id" FOREIGN KEY ("agent_id") REFERENCES "sales_agents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_commissions" ADD CONSTRAINT "fk_sales_agent_commissions__link_id" FOREIGN KEY ("link_id") REFERENCES "sales_agent_links"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_commissions" ADD CONSTRAINT "fk_sales_agent_commissions__factory_link_id" FOREIGN KEY ("factory_link_id") REFERENCES "sales_agent_factory_links"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_commissions" ADD CONSTRAINT "fk_sales_agent_commissions__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_commissions" ADD CONSTRAINT "fk_sales_agent_commissions__order_group_id" FOREIGN KEY ("order_group_id") REFERENCES "order_groups"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_commissions" ADD CONSTRAINT "fk_sales_agent_commissions__plan_version_id" FOREIGN KEY ("plan_version_id") REFERENCES "sales_agent_plan_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_commissions" ADD CONSTRAINT "fk_sales_agent_commissions__statement_id" FOREIGN KEY ("statement_id") REFERENCES "sales_agent_statements"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_commissions" ADD CONSTRAINT "fk_sales_agent_commissions__reverses_commission_id" FOREIGN KEY ("reverses_commission_id") REFERENCES "sales_agent_commissions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_statements" ADD CONSTRAINT "fk_sales_agent_statements__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_statements" ADD CONSTRAINT "fk_sales_agent_statements__agent_id" FOREIGN KEY ("agent_id") REFERENCES "sales_agents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_statements" ADD CONSTRAINT "fk_sales_agent_statements__vendor_invoice_id" FOREIGN KEY ("vendor_invoice_id") REFERENCES "vendor_invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_statements" ADD CONSTRAINT "fk_sales_agent_statements__approved_by" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ---------------------------------------------------------------------------------------------------
-- Hand-written check constraints (not expressible in Prisma; listed in schema-catalog.int-spec).

ALTER TABLE "sales_agent_plan_versions"
  ADD CONSTRAINT "ck_sales_agent_plan_versions__pcts" CHECK (
    first_order_pct >= 0 AND first_order_pct <= 100 AND repeat_order_pct >= 0 AND repeat_order_pct <= 100
    AND margin_cap_pct >= 0 AND margin_cap_pct <= 100),
  ADD CONSTRAINT "ck_sales_agent_plan_versions__numbers" CHECK (
    attribution_months BETWEEN 1 AND 120 AND min_base_amount >= 0 AND factory_bounty_amount >= 0
    AND factory_qualify_jobs >= 0 AND factory_qualify_days >= 0),
  ADD CONSTRAINT "ck_sales_agent_plan_versions__decided" CHECK (
    status NOT IN ('approved', 'rejected') OR decided_at IS NOT NULL);

ALTER TABLE "sales_agent_applications"
  ADD CONSTRAINT "ck_sales_agent_applications__tax_id" CHECK (tax_id ~ '^[0-9]{13}$'),
  ADD CONSTRAINT "ck_sales_agent_applications__postcode" CHECK (postcode ~ '^[0-9]{5}$'),
  ADD CONSTRAINT "ck_sales_agent_applications__last4" CHECK (bank_account_no_last4 ~ '^[0-9]{4}$'),
  ADD CONSTRAINT "ck_sales_agent_applications__evidence" CHECK (octet_length(agreement_evidence_sha256) = 32),
  ADD CONSTRAINT "ck_sales_agent_applications__decided" CHECK (
    status IN ('submitted', 'withdrawn') OR decided_at IS NOT NULL);


ALTER TABLE "sales_agents"
  ADD CONSTRAINT "ck_sales_agents__code" CHECK (code ~ '^[A-Z0-9]{6,12}$'),
  ADD CONSTRAINT "ck_sales_agents__kind" CHECK (
    (kind = 'freelance' AND vendor_id IS NOT NULL AND tax_id IS NOT NULL)
    OR (kind = 'employee' AND vendor_id IS NULL AND employee_code IS NOT NULL)),
  ADD CONSTRAINT "ck_sales_agents__status" CHECK (
    (status <> 'suspended' OR suspended_at IS NOT NULL) AND (status <> 'ended' OR ended_at IS NOT NULL));

ALTER TABLE "sales_agent_links"
  ADD CONSTRAINT "ck_sales_agent_links__owner" CHECK ((customer_user_id IS NULL) <> (company_id IS NULL)),
  ADD CONSTRAINT "ck_sales_agent_links__ended" CHECK (status <> 'ended' OR ended_at IS NOT NULL),
  ADD CONSTRAINT "ck_sales_agent_links__window" CHECK (ends_at > attributed_at);


ALTER TABLE "sales_agent_leads"
  ADD CONSTRAINT "ck_sales_agent_leads__contact" CHECK (phone IS NOT NULL OR email IS NOT NULL OR tax_id IS NOT NULL),
  ADD CONSTRAINT "ck_sales_agent_leads__tax_id" CHECK (tax_id IS NULL OR tax_id ~ '^[0-9]{13}$'),
  ADD CONSTRAINT "ck_sales_agent_leads__converted" CHECK (status <> 'converted' OR converted_at IS NOT NULL);


ALTER TABLE "sales_agent_factory_links"
  ADD CONSTRAINT "ck_sales_agent_factory_links__qualified" CHECK (status <> 'qualified' OR qualified_at IS NOT NULL);

ALTER TABLE "sales_agent_commissions"
  ADD CONSTRAINT "ck_sales_agent_commissions__source" CHECK (
    (kind = 'order' AND order_id IS NOT NULL AND link_id IS NOT NULL)
    OR (kind = 'factory_bounty' AND factory_link_id IS NOT NULL)
    OR (kind = 'reversal' AND reverses_commission_id IS NOT NULL AND amount <= 0)
    OR (kind = 'adjustment' AND note IS NOT NULL)),
  ADD CONSTRAINT "ck_sales_agent_commissions__amounts" CHECK (base_amount >= 0 AND (cap_amount IS NULL OR cap_amount >= 0)),
  ADD CONSTRAINT "ck_sales_agent_commissions__statemented" CHECK (
    status NOT IN ('statemented', 'paid') OR statement_id IS NOT NULL),
  ADD CONSTRAINT "ck_sales_agent_commissions__earned" CHECK (
    status NOT IN ('earned', 'statemented', 'paid') OR earned_at IS NOT NULL);


ALTER TABLE "sales_agent_statements"
  ADD CONSTRAINT "ck_sales_agent_statements__period" CHECK (period_end >= period_start),
  ADD CONSTRAINT "ck_sales_agent_statements__total" CHECK (total_amount > 0 AND entry_count > 0),
  ADD CONSTRAINT "ck_sales_agent_statements__voided" CHECK (status <> 'voided' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL)),
  ADD CONSTRAINT "ck_sales_agent_statements__approved" CHECK (status IN ('draft', 'voided') OR approved_at IS NOT NULL);


-- Existing environments: tax reports reconcile ภ.ง.ด.1 to account 2233 (D-421). A new approved version of
-- `tax.gl_accounts` adds the key; fresh databases get it from the seed.
DO $$
DECLARE s_id BIGINT; v JSONB; n INT;
BEGIN
  SELECT id INTO s_id FROM settings WHERE key = 'tax.gl_accounts' AND scope_type = 'platform' AND scope_id IS NULL;
  IF s_id IS NULL THEN RETURN; END IF;
  SELECT value, version_no INTO v, n FROM setting_versions
   WHERE setting_id = s_id AND status = 'approved' ORDER BY effective_from DESC, version_no DESC LIMIT 1;
  IF v IS NULL OR v ? 'wht_pnd1' THEN RETURN; END IF;
  SELECT max(version_no) INTO n FROM setting_versions WHERE setting_id = s_id;
  INSERT INTO setting_versions (setting_id, version_no, effective_from, status, value, reason, decided_at)
  VALUES (s_id, n + 1, CURRENT_TIMESTAMP, 'approved', v || '{"wht_pnd1": ["2233"]}'::jsonb,
          'D-421: ภ.ง.ด.1 withholding on agent commission reconciles to 2233 (migration 20261208000001)', CURRENT_TIMESTAMP);
END $$;

-- Existing environments: posting rules that credit withholding by form learn ภ.ง.ด.1 → 2233 (D-421) in a new
-- approved version from now; fresh databases get it from the seed.
DO $$
DECLARE r RECORD; t TEXT;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (v.posting_rule_id) v.posting_rule_id, v.version_no, v.conditions, v.template
      FROM posting_rule_versions v
     WHERE v.status = 'approved'
     ORDER BY v.posting_rule_id, v.effective_from DESC, v.version_no DESC
  LOOP
    t := r.template::text;
    CONTINUE WHEN position('"switch": "whtForm"' IN t) = 0 OR position('"pnd1"' IN t) > 0;
    t := replace(t, '"pnd53": "2231"', '"pnd1": "2233", "pnd53": "2231"');
    t := replace(t, '"pnd53": "wht_pnd53"', '"pnd1": "wht_pnd1", "pnd53": "wht_pnd53"');
    INSERT INTO posting_rule_versions (posting_rule_id, version_no, effective_from, status, conditions, template, reason, decided_at)
    VALUES (r.posting_rule_id,
            (SELECT max(version_no) + 1 FROM posting_rule_versions WHERE posting_rule_id = r.posting_rule_id),
            CURRENT_TIMESTAMP, 'approved', r.conditions, t::jsonb,
            'D-421: withholding on agent commission (ภ.ง.ด.1) credits 2233 (migration 20261208000001)', CURRENT_TIMESTAMP);
  END LOOP;
END $$;
