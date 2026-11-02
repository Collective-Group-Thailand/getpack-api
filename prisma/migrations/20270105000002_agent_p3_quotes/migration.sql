-- D-468 (agent portal pack, Phase 3): quotes agents send on behalf of getpack (status, timestamps, encrypted share
-- token) and the agent notification event quote_opened. Non-destructive. Rollback: down.sql.
-- CreateEnum
CREATE TYPE "sales_agent_quote_status" AS ENUM ('sent', 'opened', 'accepted', 'expired', 'withdrawn');

-- AlterEnum
ALTER TYPE "sales_agent_notification_event" ADD VALUE 'quote_opened';

-- CreateTable
CREATE TABLE "sales_agent_quotes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "agent_id" BIGINT NOT NULL,
    "lead_id" BIGINT NOT NULL,
    "quote_id" BIGINT NOT NULL,
    "anonymous_id" UUID NOT NULL,
    "status" "sales_agent_quote_status" NOT NULL DEFAULT 'sent',
    "share_token_enc" BYTEA,
    "sent_at" TIMESTAMPTZ(6) NOT NULL,
    "send_count" INTEGER NOT NULL DEFAULT 1,
    "opened_at" TIMESTAMPTZ(6),
    "accepted_at" TIMESTAMPTZ(6),
    "withdrawn_at" TIMESTAMPTZ(6),
    "withdrawn_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_sales_agent_quotes" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_quotes__public_id" ON "sales_agent_quotes"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_quotes__quote_id" ON "sales_agent_quotes"("quote_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_quotes__agent_id__created_at" ON "sales_agent_quotes"("agent_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_sales_agent_quotes__lead_id" ON "sales_agent_quotes"("lead_id");

-- AddForeignKey
ALTER TABLE "sales_agent_quotes" ADD CONSTRAINT "fk_sales_agent_quotes__agent_id" FOREIGN KEY ("agent_id") REFERENCES "sales_agents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_quotes" ADD CONSTRAINT "fk_sales_agent_quotes__lead_id" FOREIGN KEY ("lead_id") REFERENCES "sales_agent_leads"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_quotes" ADD CONSTRAINT "fk_sales_agent_quotes__quote_id" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

