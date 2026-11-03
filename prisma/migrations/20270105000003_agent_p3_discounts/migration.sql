-- D-468 (agent portal pack, Phase 3): agent discount requests with give-get and competitor evidence (one open round
-- per quote version, every round kept) and the options offered for them (standard / co-fund / spiff, accepted by
-- the agent with evidence). Non-destructive. Rollback: down.sql.
-- CreateEnum
CREATE TYPE "sales_agent_discount_request_status" AS ENUM ('open', 'offered', 'accepted', 'rejected', 'closed');

-- CreateEnum
CREATE TYPE "sales_agent_discount_reason" AS ENUM ('competitor_price', 'budget', 'volume', 'strategic_account', 'other');

-- CreateEnum
CREATE TYPE "sales_agent_commitment" AS ENUM ('one_off', 'call_off');

-- CreateEnum
CREATE TYPE "sales_agent_discount_option_kind" AS ENUM ('standard', 'co_fund', 'spiff');

-- CreateEnum
CREATE TYPE "sales_agent_discount_option_status" AS ENUM ('offered', 'accepted', 'lapsed');

-- CreateTable
CREATE TABLE "sales_agent_discount_requests" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "agent_id" BIGINT NOT NULL,
    "agent_quote_id" BIGINT NOT NULL,
    "quote_id" BIGINT NOT NULL,
    "quote_option_id" BIGINT NOT NULL,
    "round" SMALLINT NOT NULL,
    "status" "sales_agent_discount_request_status" NOT NULL DEFAULT 'open',
    "requested_pct" DECIMAL(7,4) NOT NULL,
    "reason" "sales_agent_discount_reason" NOT NULL,
    "reason_note" TEXT,
    "quantity_change" INTEGER,
    "commitment" "sales_agent_commitment" NOT NULL DEFAULT 'one_off',
    "commitment_months" SMALLINT,
    "deposit_pct" DECIMAL(7,4),
    "cash_within_days" SMALLINT,
    "lead_time_flex_days" SMALLINT,
    "spec_change" TEXT,
    "give_get_sha256" BYTEA NOT NULL,
    "competitor_file_id" BIGINT,
    "competitor_spec" JSONB,
    "created_by" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" BIGINT,
    "decision_note" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_sales_agent_discount_requests" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_agent_discount_options" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "request_id" BIGINT NOT NULL,
    "position" SMALLINT NOT NULL,
    "kind" "sales_agent_discount_option_kind" NOT NULL,
    "status" "sales_agent_discount_option_status" NOT NULL DEFAULT 'offered',
    "discount_pct" DECIMAL(7,4) NOT NULL,
    "base_amount" DECIMAL(14,2) NOT NULL,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "rate_pct" DECIMAL(7,4) NOT NULL,
    "standard_rate_pct" DECIMAL(7,4) NOT NULL,
    "commission_amount" DECIMAL(14,2) NOT NULL,
    "conditions_th" TEXT,
    "conditions_en" TEXT,
    "valid_until" TIMESTAMPTZ(6) NOT NULL,
    "offered_by" BIGINT,
    "offered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ(6),
    "accepted_by" BIGINT,
    "accepted_ip" INET,
    "accepted_user_agent" TEXT,
    "accepted_snapshot" JSONB,
    "accepted_sha256" BYTEA,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_sales_agent_discount_options" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_discount_requests__public_id" ON "sales_agent_discount_requests"("public_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_discount_requests__agent_id__created_at" ON "sales_agent_discount_requests"("agent_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_sales_agent_discount_requests__agent_quote_id" ON "sales_agent_discount_requests"("agent_quote_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_discount_requests__quote_option_id" ON "sales_agent_discount_requests"("quote_option_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_discount_requests__competitor_file_id" ON "sales_agent_discount_requests"("competitor_file_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_discount_requests__created_by" ON "sales_agent_discount_requests"("created_by");

-- CreateIndex
CREATE INDEX "ix_sales_agent_discount_requests__decided_by" ON "sales_agent_discount_requests"("decided_by");

-- CreateIndex
CREATE INDEX "ix_sales_agent_discount_requests__status__created_at" ON "sales_agent_discount_requests"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_discount_requests__quote_id__round" ON "sales_agent_discount_requests"("quote_id", "round");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_discount_requests__quote_id__open" ON "sales_agent_discount_requests"("quote_id") WHERE (status = 'open'::sales_agent_discount_request_status);

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_discount_options__public_id" ON "sales_agent_discount_options"("public_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_discount_options__offered_by" ON "sales_agent_discount_options"("offered_by");

-- CreateIndex
CREATE INDEX "ix_sales_agent_discount_options__accepted_by" ON "sales_agent_discount_options"("accepted_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_discount_options__request_id__position" ON "sales_agent_discount_options"("request_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_discount_options__request_id__accepted" ON "sales_agent_discount_options"("request_id") WHERE (status = 'accepted'::sales_agent_discount_option_status);

-- AddForeignKey
ALTER TABLE "sales_agent_discount_requests" ADD CONSTRAINT "fk_sales_agent_discount_requests__agent_id" FOREIGN KEY ("agent_id") REFERENCES "sales_agents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_discount_requests" ADD CONSTRAINT "fk_sales_agent_discount_requests__agent_quote_id" FOREIGN KEY ("agent_quote_id") REFERENCES "sales_agent_quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_discount_requests" ADD CONSTRAINT "fk_sales_agent_discount_requests__quote_id" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_discount_requests" ADD CONSTRAINT "fk_sales_agent_discount_requests__quote_option_id" FOREIGN KEY ("quote_option_id") REFERENCES "quote_options"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_discount_requests" ADD CONSTRAINT "fk_sales_agent_discount_requests__competitor_file_id" FOREIGN KEY ("competitor_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_discount_requests" ADD CONSTRAINT "fk_sales_agent_discount_requests__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_discount_requests" ADD CONSTRAINT "fk_sales_agent_discount_requests__decided_by" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_discount_options" ADD CONSTRAINT "fk_sales_agent_discount_options__request_id" FOREIGN KEY ("request_id") REFERENCES "sales_agent_discount_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_discount_options" ADD CONSTRAINT "fk_sales_agent_discount_options__offered_by" FOREIGN KEY ("offered_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_discount_options" ADD CONSTRAINT "fk_sales_agent_discount_options__accepted_by" FOREIGN KEY ("accepted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


ALTER TABLE sales_agent_discount_requests ADD CONSTRAINT ck_sales_agent_discount_requests__pct CHECK (requested_pct > 0 AND requested_pct < 100);
ALTER TABLE sales_agent_discount_options ADD CONSTRAINT ck_sales_agent_discount_options__position CHECK (position BETWEEN 1 AND 3);
ALTER TABLE sales_agent_discount_options ADD CONSTRAINT ck_sales_agent_discount_options__pct CHECK (discount_pct >= 0 AND discount_pct < 100 AND rate_pct >= 0 AND rate_pct <= 100);
