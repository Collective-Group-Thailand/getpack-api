-- D-468 (agent portal pack, Phase 3; PLAN A-11): deal registration — protection + rate lock for big quotes and
-- call-off agreements (automatic) or on the agent's request; quotes point to it. Non-destructive. Rollback: down.sql.
-- CreateEnum
CREATE TYPE "sales_agent_deal_scope" AS ENUM ('quote', 'call_off_agreement');

-- CreateEnum
CREATE TYPE "sales_agent_deal_status" AS ENUM ('registered', 'won', 'lost', 'expired');

-- CreateEnum
CREATE TYPE "sales_agent_deal_origin" AS ENUM ('automatic', 'requested');

-- AlterTable
ALTER TABLE "sales_agent_quotes" ADD COLUMN     "deal_registration_id" BIGINT;

-- CreateTable
CREATE TABLE "sales_agent_deal_registrations" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "agent_id" BIGINT NOT NULL,
    "lead_id" BIGINT NOT NULL,
    "scope" "sales_agent_deal_scope" NOT NULL DEFAULT 'quote',
    "call_off_agreement_id" BIGINT,
    "origin" "sales_agent_deal_origin" NOT NULL,
    "status" "sales_agent_deal_status" NOT NULL DEFAULT 'registered',
    "locked_first_rate_pct" DECIMAL(7,4) NOT NULL,
    "locked_repeat_rate_pct" DECIMAL(7,4) NOT NULL,
    "plan_version_id" BIGINT NOT NULL,
    "approved_option_id" BIGINT,
    "protected_until" TIMESTAMPTZ(6) NOT NULL,
    "threshold_snapshot" JSONB NOT NULL,
    "registered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "ended_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_sales_agent_deal_registrations" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_deal_registrations__public_id" ON "sales_agent_deal_registrations"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_deal_registrations__approved_option_id" ON "sales_agent_deal_registrations"("approved_option_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_deal_registrations__agent_id__status" ON "sales_agent_deal_registrations"("agent_id", "status");

-- CreateIndex
CREATE INDEX "ix_sales_agent_deal_registrations__status__protected_until" ON "sales_agent_deal_registrations"("status", "protected_until");

-- CreateIndex
CREATE INDEX "ix_sales_agent_deal_registrations__call_off_agreement_id" ON "sales_agent_deal_registrations"("call_off_agreement_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_deal_registrations__plan_version_id" ON "sales_agent_deal_registrations"("plan_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_deal_registrations__lead_id__registered" ON "sales_agent_deal_registrations"("lead_id") WHERE (status = 'registered'::sales_agent_deal_status);

-- CreateIndex
CREATE INDEX "ix_sales_agent_quotes__deal_registration_id" ON "sales_agent_quotes"("deal_registration_id");

-- AddForeignKey
ALTER TABLE "sales_agent_quotes" ADD CONSTRAINT "fk_sales_agent_quotes__deal_registration_id" FOREIGN KEY ("deal_registration_id") REFERENCES "sales_agent_deal_registrations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_deal_registrations" ADD CONSTRAINT "fk_sales_agent_deal_registrations__agent_id" FOREIGN KEY ("agent_id") REFERENCES "sales_agents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_deal_registrations" ADD CONSTRAINT "fk_sales_agent_deal_registrations__lead_id" FOREIGN KEY ("lead_id") REFERENCES "sales_agent_leads"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_deal_registrations" ADD CONSTRAINT "fk_sales_agent_deal_registrations__call_off_agreement_id" FOREIGN KEY ("call_off_agreement_id") REFERENCES "call_off_agreements"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_deal_registrations" ADD CONSTRAINT "fk_sales_agent_deal_registrations__plan_version_id" FOREIGN KEY ("plan_version_id") REFERENCES "sales_agent_plan_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_deal_registrations" ADD CONSTRAINT "fk_sales_agent_deal_registrations__approved_option_id" FOREIGN KEY ("approved_option_id") REFERENCES "sales_agent_discount_options"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

