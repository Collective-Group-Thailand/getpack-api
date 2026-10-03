-- U2.3 (schema-design A-89; D-190, D-191, D-247–D-252): the customer's target price on draft configurations,
-- quotations and RFQs; levers re-priced by the real engine (write-once, valid with their quotation); one write-once
-- outcome per saved quotation (won / lost / expired / converted to RFQ / revised) with the target, the gap and the
-- levers; quotations declined or sent to CS; price-gap unmet demand with a distinct-customer key for k-anonymity.
-- CreateEnum
CREATE TYPE "quote_lever_kind" AS ENUM ('quantity', 'material', 'back_print', 'special_finish', 'coating', 'assembly');

-- CreateEnum
CREATE TYPE "quote_outcome_kind" AS ENUM ('won', 'lost', 'expired', 'converted_to_rfq', 'revised');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "quote_status" ADD VALUE 'declined';
ALTER TYPE "quote_status" ADD VALUE 'routed_to_rfq';

-- AlterEnum
ALTER TYPE "unmet_demand_source" ADD VALUE 'price_above_target';

-- AlterTable
ALTER TABLE "configuration_drafts" ADD COLUMN     "target_price_per_unit" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "from_lever_id" BIGINT,
ADD COLUMN     "levers_computed_at" TIMESTAMPTZ(6),
ADD COLUMN     "target_price_per_unit" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "rfqs" ADD COLUMN     "routed_from_quote_id" BIGINT,
ADD COLUMN     "target_price_per_unit" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "unmet_demand_records" ADD COLUMN     "customer_key" TEXT,
ADD COLUMN     "price_gap_band" TEXT,
ADD COLUMN     "quote_id" BIGINT;

-- CreateTable
CREATE TABLE "quote_levers" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "quote_id" BIGINT NOT NULL,
    "rank" SMALLINT NOT NULL,
    "kind" "quote_lever_kind" NOT NULL,
    "changes" JSONB NOT NULL,
    "configuration" JSONB NOT NULL,
    "steps" JSONB NOT NULL,
    "reason_codes" TEXT[],
    "best_saving_pct" DECIMAL(9,4) NOT NULL,
    "valid_until" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_quote_levers" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_loss_reasons" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_quote_loss_reasons" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_outcomes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "quote_id" BIGINT NOT NULL,
    "outcome" "quote_outcome_kind" NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "target_price_per_unit" DECIMAL(14,2),
    "quantity" INTEGER,
    "unit_price" DECIMAL(18,6),
    "gap_per_unit" DECIMAL(18,6),
    "gap_pct" DECIMAL(9,4),
    "levers_shown" SMALLINT NOT NULL DEFAULT 0,
    "lever_taken_id" BIGINT,
    "loss_reason_id" BIGINT,
    "loss_note" TEXT,
    "order_id" BIGINT,
    "rfq_id" BIGINT,

    CONSTRAINT "pk_quote_outcomes" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_quote_levers__public_id" ON "quote_levers"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_quote_levers__quote_id__rank" ON "quote_levers"("quote_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "ux_quote_loss_reasons__code" ON "quote_loss_reasons"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ux_quote_outcomes__quote_id" ON "quote_outcomes"("quote_id");

-- CreateIndex
CREATE INDEX "ix_quote_outcomes__outcome__occurred_at" ON "quote_outcomes"("outcome", "occurred_at");

-- CreateIndex
CREATE INDEX "ix_quote_outcomes__lever_taken_id" ON "quote_outcomes"("lever_taken_id");

-- CreateIndex
CREATE INDEX "ix_quote_outcomes__loss_reason_id" ON "quote_outcomes"("loss_reason_id");

-- CreateIndex
CREATE INDEX "ix_quote_outcomes__order_id" ON "quote_outcomes"("order_id");

-- CreateIndex
CREATE INDEX "ix_quote_outcomes__rfq_id" ON "quote_outcomes"("rfq_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_quotes__from_lever_id" ON "quotes"("from_lever_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_rfqs__routed_from_quote_id" ON "rfqs"("routed_from_quote_id");

-- CreateIndex
CREATE INDEX "ix_unmet_demand_records__quote_id" ON "unmet_demand_records"("quote_id");

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "fk_quotes__from_lever_id" FOREIGN KEY ("from_lever_id") REFERENCES "quote_levers"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "fk_rfqs__routed_from_quote_id" FOREIGN KEY ("routed_from_quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "unmet_demand_records" ADD CONSTRAINT "fk_unmet_demand_records__quote_id" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "quote_levers" ADD CONSTRAINT "fk_quote_levers__quote_id" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "quote_outcomes" ADD CONSTRAINT "fk_quote_outcomes__quote_id" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "quote_outcomes" ADD CONSTRAINT "fk_quote_outcomes__lever_taken_id" FOREIGN KEY ("lever_taken_id") REFERENCES "quote_levers"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "quote_outcomes" ADD CONSTRAINT "fk_quote_outcomes__loss_reason_id" FOREIGN KEY ("loss_reason_id") REFERENCES "quote_loss_reasons"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "quote_outcomes" ADD CONSTRAINT "fk_quote_outcomes__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "quote_outcomes" ADD CONSTRAINT "fk_quote_outcomes__rfq_id" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written checks and triggers (A-89).
ALTER TABLE configuration_drafts
  ADD CONSTRAINT ck_configuration_drafts__target_price CHECK (target_price_per_unit IS NULL OR target_price_per_unit > 0);
ALTER TABLE quotes
  ADD CONSTRAINT ck_quotes__target_price CHECK (target_price_per_unit IS NULL OR target_price_per_unit > 0);
ALTER TABLE rfqs
  ADD CONSTRAINT ck_rfqs__target_price CHECK (target_price_per_unit IS NULL OR target_price_per_unit > 0);
ALTER TABLE quote_levers
  ADD CONSTRAINT ck_quote_levers__rank CHECK (rank >= 1),
  ADD CONSTRAINT ck_quote_levers__configuration CHECK (jsonb_typeof(configuration) = 'object'),
  ADD CONSTRAINT ck_quote_levers__steps CHECK (jsonb_typeof(steps) = 'array'),
  ADD CONSTRAINT ck_quote_levers__saving CHECK (best_saving_pct > 0);
ALTER TABLE quote_outcomes
  ADD CONSTRAINT ck_quote_outcomes__levers_shown CHECK (levers_shown >= 0),
  ADD CONSTRAINT ck_quote_outcomes__won CHECK (outcome <> 'won' OR order_id IS NOT NULL),
  ADD CONSTRAINT ck_quote_outcomes__rfq CHECK (outcome <> 'converted_to_rfq' OR rfq_id IS NOT NULL),
  ADD CONSTRAINT ck_quote_outcomes__revised CHECK (outcome <> 'revised' OR lever_taken_id IS NOT NULL),
  ADD CONSTRAINT ck_quote_outcomes__loss CHECK (outcome = 'lost' OR (loss_reason_id IS NULL AND loss_note IS NULL));
ALTER TABLE unmet_demand_records
  ADD CONSTRAINT ck_unmet_demand_records__price_gap CHECK (
    (source = 'price_above_target') = (quote_id IS NOT NULL AND price_gap_band IS NOT NULL AND customer_key IS NOT NULL));

-- D-248 / D-250: levers and outcomes are write-once records of what the customer was shown and did.
CREATE TRIGGER tg_quote_levers__write_once BEFORE UPDATE OR DELETE ON quote_levers
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER tg_quote_outcomes__write_once BEFORE UPDATE OR DELETE ON quote_outcomes
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- D-247 / D-249: the target and the lever a quotation came from are set when it is saved; the levers are computed once.
CREATE FUNCTION tg_quotes__target_write_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.target_price_per_unit IS DISTINCT FROM OLD.target_price_per_unit
     OR NEW.from_lever_id IS DISTINCT FROM OLD.from_lever_id
     OR (OLD.levers_computed_at IS NOT NULL AND NEW.levers_computed_at IS DISTINCT FROM OLD.levers_computed_at) THEN
    RAISE EXCEPTION 'quote % target / lever link is write-once', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_quotes__target_write_once BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION tg_quotes__target_write_once();
