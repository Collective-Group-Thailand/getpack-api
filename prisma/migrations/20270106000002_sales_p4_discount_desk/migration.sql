-- D-470 (agent portal pack, Phase 4; PLAN A-12, §7): the discount approval desk — approvals with their waterfall and
-- snapshot, factory buy-price locks of big deals, the waterfall access log (append-only) and discounted quotations.
-- Non-destructive. Rollback: down.sql.
-- CreateEnum
CREATE TYPE "sales_discount_approval_level" AS ENUM ('rep', 'sales_manager', 'c_level');

-- CreateEnum
CREATE TYPE "sales_discount_approval_status" AS ENUM ('pending', 'approved', 'rejected', 'countered', 'stale', 'withdrawn');

-- CreateEnum
CREATE TYPE "sales_factory_price_lock_status" AS ENUM ('requested', 'confirmed', 'expired', 'released');

-- CreateEnum
CREATE TYPE "sales_waterfall_tier" AS ENUM ('authority', 'margin_pct', 'full');

-- CreateEnum
CREATE TYPE "sales_waterfall_view_purpose" AS ENUM ('view', 'simulate', 'export');

-- CreateTable
CREATE TABLE "sales_discount_approvals" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "request_id" BIGINT NOT NULL,
    "agent_quote_id" BIGINT NOT NULL,
    "quote_id" BIGINT NOT NULL,
    "level" "sales_discount_approval_level" NOT NULL,
    "base_level" "sales_discount_approval_level" NOT NULL,
    "negotiation_heavy" BOOLEAN NOT NULL DEFAULT false,
    "status" "sales_discount_approval_status" NOT NULL DEFAULT 'pending',
    "requested_pct" DECIMAL(7,4) NOT NULL,
    "gross_margin_pct" DECIMAL(9,4) NOT NULL,
    "floor_pct" DECIMAL(7,4) NOT NULL,
    "below_floor" BOOLEAN NOT NULL DEFAULT false,
    "commission_base" DECIMAL(14,2) NOT NULL,
    "waterfall" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshot_sha256" BYTEA NOT NULL,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "escalated_at" TIMESTAMPTZ(6),
    "requested_by" BIGINT NOT NULL,
    "decided_by" BIGINT,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "self_approved" BOOLEAN NOT NULL DEFAULT false,
    "self_approval_reason" TEXT,
    "counter" JSONB,
    "approved_options" JSONB,
    "valid_until" TIMESTAMPTZ(6),
    "stale_at" TIMESTAMPTZ(6),
    "stale_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_sales_discount_approvals" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_factory_price_locks" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "approval_id" BIGINT NOT NULL,
    "quote_option_id" BIGINT NOT NULL,
    "factory_id" BIGINT,
    "price_list_version_id" BIGINT,
    "buy_price" DECIMAL(14,2) NOT NULL,
    "status" "sales_factory_price_lock_status" NOT NULL DEFAULT 'requested',
    "valid_until" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_sales_factory_price_locks" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_waterfall_views" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "viewer_user_id" BIGINT NOT NULL,
    "quote_id" BIGINT NOT NULL,
    "approval_id" BIGINT,
    "tier" "sales_waterfall_tier" NOT NULL,
    "purpose" "sales_waterfall_view_purpose" NOT NULL,
    "request_id" TEXT,
    "viewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_sales_waterfall_views" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_discounted_quotes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "quote_id" BIGINT NOT NULL,
    "source_quote_id" BIGINT NOT NULL,
    "approval_id" BIGINT,
    "option_id" BIGINT NOT NULL,
    "discount_memo_id" BIGINT,
    "discount_pct" DECIMAL(7,4) NOT NULL,
    "discount_amount" DECIMAL(14,2) NOT NULL,
    "conditions_th" TEXT,
    "conditions_en" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_sales_discounted_quotes" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_discount_approvals__public_id" ON "sales_discount_approvals"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_discount_approvals__request_id" ON "sales_discount_approvals"("request_id");

-- CreateIndex
CREATE INDEX "ix_sales_discount_approvals__status__level__due_at" ON "sales_discount_approvals"("status", "level", "due_at");

-- CreateIndex
CREATE INDEX "ix_sales_discount_approvals__agent_quote_id" ON "sales_discount_approvals"("agent_quote_id");

-- CreateIndex
CREATE INDEX "ix_sales_discount_approvals__quote_id" ON "sales_discount_approvals"("quote_id");

-- CreateIndex
CREATE INDEX "ix_sales_discount_approvals__requested_by" ON "sales_discount_approvals"("requested_by");

-- CreateIndex
CREATE INDEX "ix_sales_discount_approvals__decided_by" ON "sales_discount_approvals"("decided_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_factory_price_locks__public_id" ON "sales_factory_price_locks"("public_id");

-- CreateIndex
CREATE INDEX "ix_sales_factory_price_locks__approval_id" ON "sales_factory_price_locks"("approval_id");

-- CreateIndex
CREATE INDEX "ix_sales_factory_price_locks__quote_option_id" ON "sales_factory_price_locks"("quote_option_id");

-- CreateIndex
CREATE INDEX "ix_sales_factory_price_locks__factory_id__status" ON "sales_factory_price_locks"("factory_id", "status");

-- CreateIndex
CREATE INDEX "ix_sales_factory_price_locks__price_list_version_id" ON "sales_factory_price_locks"("price_list_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_waterfall_views__public_id" ON "sales_waterfall_views"("public_id");

-- CreateIndex
CREATE INDEX "ix_sales_waterfall_views__viewed_at" ON "sales_waterfall_views"("viewed_at");

-- CreateIndex
CREATE INDEX "ix_sales_waterfall_views__viewer_user_id__viewed_at" ON "sales_waterfall_views"("viewer_user_id", "viewed_at");

-- CreateIndex
CREATE INDEX "ix_sales_waterfall_views__quote_id" ON "sales_waterfall_views"("quote_id");

-- CreateIndex
CREATE INDEX "ix_sales_waterfall_views__approval_id" ON "sales_waterfall_views"("approval_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_discounted_quotes__public_id" ON "sales_discounted_quotes"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_discounted_quotes__quote_id" ON "sales_discounted_quotes"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_discounted_quotes__option_id" ON "sales_discounted_quotes"("option_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_discounted_quotes__discount_memo_id" ON "sales_discounted_quotes"("discount_memo_id");

-- CreateIndex
CREATE INDEX "ix_sales_discounted_quotes__source_quote_id" ON "sales_discounted_quotes"("source_quote_id");

-- CreateIndex
CREATE INDEX "ix_sales_discounted_quotes__approval_id" ON "sales_discounted_quotes"("approval_id");

-- AddForeignKey
ALTER TABLE "sales_discount_approvals" ADD CONSTRAINT "fk_sales_discount_approvals__request_id" FOREIGN KEY ("request_id") REFERENCES "sales_agent_discount_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_discount_approvals" ADD CONSTRAINT "fk_sales_discount_approvals__agent_quote_id" FOREIGN KEY ("agent_quote_id") REFERENCES "sales_agent_quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_discount_approvals" ADD CONSTRAINT "fk_sales_discount_approvals__quote_id" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_discount_approvals" ADD CONSTRAINT "fk_sales_discount_approvals__requested_by" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_discount_approvals" ADD CONSTRAINT "fk_sales_discount_approvals__decided_by" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_factory_price_locks" ADD CONSTRAINT "fk_sales_factory_price_locks__approval_id" FOREIGN KEY ("approval_id") REFERENCES "sales_discount_approvals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_factory_price_locks" ADD CONSTRAINT "fk_sales_factory_price_locks__quote_option_id" FOREIGN KEY ("quote_option_id") REFERENCES "quote_options"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_factory_price_locks" ADD CONSTRAINT "fk_sales_factory_price_locks__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_factory_price_locks" ADD CONSTRAINT "fk_sales_factory_price_locks__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_waterfall_views" ADD CONSTRAINT "fk_sales_waterfall_views__viewer_user_id" FOREIGN KEY ("viewer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_waterfall_views" ADD CONSTRAINT "fk_sales_waterfall_views__quote_id" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_waterfall_views" ADD CONSTRAINT "fk_sales_waterfall_views__approval_id" FOREIGN KEY ("approval_id") REFERENCES "sales_discount_approvals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_discounted_quotes" ADD CONSTRAINT "fk_sales_discounted_quotes__quote_id" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_discounted_quotes" ADD CONSTRAINT "fk_sales_discounted_quotes__source_quote_id" FOREIGN KEY ("source_quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_discounted_quotes" ADD CONSTRAINT "fk_sales_discounted_quotes__approval_id" FOREIGN KEY ("approval_id") REFERENCES "sales_discount_approvals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_discounted_quotes" ADD CONSTRAINT "fk_sales_discounted_quotes__option_id" FOREIGN KEY ("option_id") REFERENCES "sales_agent_discount_options"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_discounted_quotes" ADD CONSTRAINT "fk_sales_discounted_quotes__discount_memo_id" FOREIGN KEY ("discount_memo_id") REFERENCES "discount_memos"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


CREATE TRIGGER tg_sales_waterfall_views__append_only BEFORE UPDATE OR DELETE ON sales_waterfall_views
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
