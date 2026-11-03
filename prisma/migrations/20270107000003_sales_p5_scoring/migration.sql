-- D-471 (agent portal pack, Phase 5): the lead score 0–100 of inbound items and agent leads, its top 3 reasons (staff
-- only), when it was computed and the sales.scoring_rules setting version used (a reference for traceability).
-- Derived values, non-destructive. Rollback: down.sql.
-- AlterTable
ALTER TABLE "sales_agent_leads" ADD COLUMN     "score" SMALLINT,
ADD COLUMN     "score_reasons" JSONB,
ADD COLUMN     "score_setting_version_id" BIGINT,
ADD COLUMN     "scored_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "sales_inbound_leads" ADD COLUMN     "score" SMALLINT,
ADD COLUMN     "score_reasons" JSONB,
ADD COLUMN     "score_setting_version_id" BIGINT,
ADD COLUMN     "scored_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "ix_sales_agent_leads__scored_at" ON "sales_agent_leads"("scored_at");

-- CreateIndex
CREATE INDEX "ix_sales_inbound_leads__score" ON "sales_inbound_leads"("score" DESC);

-- CreateIndex
CREATE INDEX "ix_sales_inbound_leads__scored_at" ON "sales_inbound_leads"("scored_at");

ALTER TABLE "sales_agent_leads" ADD CONSTRAINT "ck_sales_agent_leads__score" CHECK (score IS NULL OR score BETWEEN 0 AND 100);
ALTER TABLE "sales_inbound_leads" ADD CONSTRAINT "ck_sales_inbound_leads__score" CHECK (score IS NULL OR score BETWEEN 0 AND 100);
