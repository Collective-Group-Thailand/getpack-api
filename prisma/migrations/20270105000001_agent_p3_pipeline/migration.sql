-- D-468 (agent portal pack, Phase 3): the lead pipeline — stage, expected value, follow-up, lost reason, source,
-- industry, LINE id, tags — the lead timeline (append-only) and CSV lead imports; the agent notification event
-- follow_up_due. Non-destructive. Rollback: down.sql.
-- CreateEnum
CREATE TYPE "sales_agent_lead_stage" AS ENUM ('new', 'contacted', 'quoted', 'negotiating', 'won', 'lost');

-- CreateEnum
CREATE TYPE "sales_agent_lead_lost_reason" AS ENUM ('price', 'lead_time', 'no_need', 'competitor', 'no_response', 'other');

-- CreateEnum
CREATE TYPE "sales_agent_lead_source" AS ENUM ('manual', 'card_scan', 'csv_import', 'link', 'staff');

-- CreateEnum
CREATE TYPE "sales_agent_lead_activity_kind" AS ENUM ('call', 'line', 'visit', 'email', 'note', 'quote_sent', 'stage_change', 'system');

-- CreateEnum
CREATE TYPE "sales_agent_lead_import_status" AS ENUM ('previewed', 'committed', 'expired');

-- AlterEnum
ALTER TYPE "sales_agent_notification_event" ADD VALUE 'follow_up_due';

-- AlterTable
ALTER TABLE "sales_agent_leads" ADD COLUMN     "expected_value" DECIMAL(14,2),
ADD COLUMN     "follow_up_reminded_at" TIMESTAMPTZ(6),
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "line_id" TEXT,
ADD COLUMN     "lost_note" TEXT,
ADD COLUMN     "lost_reason" "sales_agent_lead_lost_reason",
ADD COLUMN     "next_follow_up_at" TIMESTAMPTZ(6),
ADD COLUMN     "source" "sales_agent_lead_source" NOT NULL DEFAULT 'manual',
ADD COLUMN     "stage" "sales_agent_lead_stage" NOT NULL DEFAULT 'new',
ADD COLUMN     "stage_changed_at" TIMESTAMPTZ(6),
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "won_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "sales_agent_lead_activities" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "lead_id" BIGINT NOT NULL,
    "kind" "sales_agent_lead_activity_kind" NOT NULL,
    "body" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_sales_agent_lead_activities" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_agent_lead_imports" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "agent_id" BIGINT NOT NULL,
    "status" "sales_agent_lead_import_status" NOT NULL DEFAULT 'previewed',
    "rows" JSONB NOT NULL,
    "row_count" INTEGER NOT NULL,
    "valid_count" INTEGER NOT NULL,
    "created_count" INTEGER,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "committed_at" TIMESTAMPTZ(6),
    "purged_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_sales_agent_lead_imports" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_lead_activities__public_id" ON "sales_agent_lead_activities"("public_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_lead_activities__lead_id__occurred_at" ON "sales_agent_lead_activities"("lead_id", "occurred_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "ix_sales_agent_lead_activities__created_by" ON "sales_agent_lead_activities"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_lead_imports__public_id" ON "sales_agent_lead_imports"("public_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_lead_imports__agent_id__created_at" ON "sales_agent_lead_imports"("agent_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_sales_agent_lead_imports__status__expires_at" ON "sales_agent_lead_imports"("status", "expires_at");

-- CreateIndex
CREATE INDEX "ix_sales_agent_leads__agent_id__stage" ON "sales_agent_leads"("agent_id", "stage");

-- CreateIndex
CREATE INDEX "ix_sales_agent_leads__next_follow_up_at__due" ON "sales_agent_leads"("next_follow_up_at") WHERE (follow_up_reminded_at IS NULL AND next_follow_up_at IS NOT NULL);

-- AddForeignKey
ALTER TABLE "sales_agent_lead_activities" ADD CONSTRAINT "fk_sales_agent_lead_activities__lead_id" FOREIGN KEY ("lead_id") REFERENCES "sales_agent_leads"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_lead_activities" ADD CONSTRAINT "fk_sales_agent_lead_activities__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_lead_imports" ADD CONSTRAINT "fk_sales_agent_lead_imports__agent_id" FOREIGN KEY ("agent_id") REFERENCES "sales_agents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- The timeline is append-only (D-468).
CREATE TRIGGER tg_sales_agent_lead_activities__append_only BEFORE UPDATE OR DELETE ON sales_agent_lead_activities
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
