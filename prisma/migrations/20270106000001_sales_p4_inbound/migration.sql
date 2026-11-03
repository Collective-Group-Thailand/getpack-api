-- D-469 (agent portal pack, Phase 4; PLAN A-07): the company sales desk's inbound pool of sales enquiries and their
-- (re)assignments (append-only). Non-destructive. Rollback: down.sql.
-- CreateEnum
CREATE TYPE "sales_inbound_source" AS ENUM ('contact_form', 'rfq', 'line_chat', 'manual');

-- CreateEnum
CREATE TYPE "sales_inbound_status" AS ENUM ('new', 'assigned', 'contacted', 'converted_to_lead', 'disqualified');

-- CreateEnum
CREATE TYPE "sales_inbound_disqualify_reason" AS ENUM ('not_a_buyer', 'duplicate', 'no_response', 'out_of_scope', 'spam', 'other');

-- CreateEnum
CREATE TYPE "sales_inbound_assignment_mode" AS ENUM ('manual', 'round_robin');

-- CreateTable
CREATE TABLE "sales_inbound_leads" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "source" "sales_inbound_source" NOT NULL,
    "source_ref" TEXT,
    "support_ticket_id" BIGINT,
    "rfq_id" BIGINT,
    "contact_name" TEXT NOT NULL,
    "contact_phone" TEXT,
    "contact_email" CITEXT,
    "organisation_name" TEXT,
    "need" TEXT,
    "status" "sales_inbound_status" NOT NULL DEFAULT 'new',
    "assignee_user_id" BIGINT,
    "assigned_at" TIMESTAMPTZ(6),
    "agent_lead_id" BIGINT,
    "lead_refusal" TEXT,
    "first_response_due_at" TIMESTAMPTZ(6) NOT NULL,
    "first_responded_at" TIMESTAMPTZ(6),
    "sla_breached_at" TIMESTAMPTZ(6),
    "disqualified_reason" "sales_inbound_disqualify_reason",
    "status_note" TEXT,
    "closed_at" TIMESTAMPTZ(6),
    "created_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_sales_inbound_leads" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_inbound_assignments" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "inbound_lead_id" BIGINT NOT NULL,
    "from_user_id" BIGINT,
    "to_user_id" BIGINT NOT NULL,
    "mode" "sales_inbound_assignment_mode" NOT NULL,
    "reason" TEXT,
    "created_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_sales_inbound_assignments" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_inbound_leads__public_id" ON "sales_inbound_leads"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_inbound_leads__support_ticket_id" ON "sales_inbound_leads"("support_ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_inbound_leads__rfq_id" ON "sales_inbound_leads"("rfq_id");

-- CreateIndex
CREATE INDEX "ix_sales_inbound_leads__status__created_at" ON "sales_inbound_leads"("status", "created_at");

-- CreateIndex
CREATE INDEX "ix_sales_inbound_leads__assignee_user_id__status" ON "sales_inbound_leads"("assignee_user_id", "status");

-- CreateIndex
CREATE INDEX "ix_sales_inbound_leads__agent_lead_id" ON "sales_inbound_leads"("agent_lead_id");

-- CreateIndex
CREATE INDEX "ix_sales_inbound_leads__created_by" ON "sales_inbound_leads"("created_by");

-- CreateIndex
CREATE INDEX "ix_sales_inbound_leads__sla_due" ON "sales_inbound_leads"("first_response_due_at") WHERE (first_responded_at IS NULL AND sla_breached_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_inbound_assignments__public_id" ON "sales_inbound_assignments"("public_id");

-- CreateIndex
CREATE INDEX "ix_sales_inbound_assignments__inbound_lead_id__created_at" ON "sales_inbound_assignments"("inbound_lead_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_sales_inbound_assignments__from_user_id" ON "sales_inbound_assignments"("from_user_id");

-- CreateIndex
CREATE INDEX "ix_sales_inbound_assignments__to_user_id__created_at" ON "sales_inbound_assignments"("to_user_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_sales_inbound_assignments__created_by" ON "sales_inbound_assignments"("created_by");

-- AddForeignKey
ALTER TABLE "sales_inbound_leads" ADD CONSTRAINT "fk_sales_inbound_leads__support_ticket_id" FOREIGN KEY ("support_ticket_id") REFERENCES "support_tickets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_inbound_leads" ADD CONSTRAINT "fk_sales_inbound_leads__rfq_id" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_inbound_leads" ADD CONSTRAINT "fk_sales_inbound_leads__assignee_user_id" FOREIGN KEY ("assignee_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_inbound_leads" ADD CONSTRAINT "fk_sales_inbound_leads__agent_lead_id" FOREIGN KEY ("agent_lead_id") REFERENCES "sales_agent_leads"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_inbound_leads" ADD CONSTRAINT "fk_sales_inbound_leads__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_inbound_assignments" ADD CONSTRAINT "fk_sales_inbound_assignments__inbound_lead_id" FOREIGN KEY ("inbound_lead_id") REFERENCES "sales_inbound_leads"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_inbound_assignments" ADD CONSTRAINT "fk_sales_inbound_assignments__from_user_id" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_inbound_assignments" ADD CONSTRAINT "fk_sales_inbound_assignments__to_user_id" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_inbound_assignments" ADD CONSTRAINT "fk_sales_inbound_assignments__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


CREATE TRIGGER tg_sales_inbound_assignments__append_only BEFORE UPDATE OR DELETE ON sales_inbound_assignments
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
