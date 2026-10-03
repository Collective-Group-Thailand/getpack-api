-- U2.5 (schema-design A-91; D-198–D-202, D-260–D-265): the published guarantee as data — effective-dated policy
-- versions (SLA days) with the claim type × severity remedy matrix, approved through `guarantee_policy_change`; claims
-- carry the version, severity, remedy, the goodwill discount memo and their SLA clocks; reviews name their product line
-- (backfilled) and carry one CS reply.
-- CreateEnum
CREATE TYPE "claim_severity" AS ENUM ('minor', 'major', 'critical');

-- CreateEnum
CREATE TYPE "guarantee_remedy" AS ENUM ('reprint', 'refund', 'partial_credit', 'goodwill');

-- AlterEnum
ALTER TYPE "claim_resolution_kind" ADD VALUE 'goodwill';

-- AlterTable
ALTER TABLE "claims" ADD COLUMN     "decision_due_at" TIMESTAMPTZ(6),
ADD COLUMN     "evidence_complete_at" TIMESTAMPTZ(6),
ADD COLUMN     "first_responded_at" TIMESTAMPTZ(6),
ADD COLUMN     "goodwill_memo_id" BIGINT,
ADD COLUMN     "guarantee_policy_version_id" BIGINT,
ADD COLUMN     "remedy" "guarantee_remedy",
ADD COLUMN     "response_due_at" TIMESTAMPTZ(6),
ADD COLUMN     "severity" "claim_severity";

-- AlterTable
ALTER TABLE "order_reviews" ADD COLUMN     "order_line_id" BIGINT,
ADD COLUMN     "replied_at" TIMESTAMPTZ(6),
ADD COLUMN     "replied_by" BIGINT,
ADD COLUMN     "reply_body" TEXT;

-- CreateTable
CREATE TABLE "guarantee_policy_versions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "version_no" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "status" "config_version_status" NOT NULL,
    "response_business_days" SMALLINT NOT NULL,
    "decision_business_days" SMALLINT NOT NULL,
    "reason" TEXT NOT NULL,
    "approval_request_id" BIGINT,
    "created_by" BIGINT,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_guarantee_policy_versions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guarantee_policy_rules" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "version_id" BIGINT NOT NULL,
    "claim_type" "claim_type" NOT NULL,
    "severity" "claim_severity" NOT NULL,
    "remedies" "guarantee_remedy"[],

    CONSTRAINT "pk_guarantee_policy_rules" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_guarantee_policy_versions__public_id" ON "guarantee_policy_versions"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_guarantee_policy_versions__version_no" ON "guarantee_policy_versions"("version_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_guarantee_policy_versions__approval_request_id" ON "guarantee_policy_versions"("approval_request_id");

-- CreateIndex
CREATE INDEX "ix_guarantee_policy_versions__status__effective_from" ON "guarantee_policy_versions"("status", "effective_from");

-- CreateIndex
CREATE INDEX "ix_guarantee_policy_versions__created_by" ON "guarantee_policy_versions"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_guarantee_policy_rules__version__type__severity" ON "guarantee_policy_rules"("version_id", "claim_type", "severity");

-- CreateIndex
CREATE INDEX "ix_claims__guarantee_policy_version_id" ON "claims"("guarantee_policy_version_id");

-- CreateIndex
CREATE INDEX "ix_claims__goodwill_memo_id" ON "claims"("goodwill_memo_id");

-- CreateIndex
CREATE INDEX "ix_claims__response_due_at" ON "claims"("response_due_at") WHERE (first_responded_at IS NULL);

-- CreateIndex
CREATE INDEX "ix_claims__decision_due_at" ON "claims"("decision_due_at") WHERE (decided_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "ux_order_reviews__order_line_id" ON "order_reviews"("order_line_id");

-- CreateIndex
CREATE INDEX "ix_order_reviews__replied_by" ON "order_reviews"("replied_by");

-- CreateIndex
CREATE INDEX "ix_order_reviews__status__created_at" ON "order_reviews"("status", "created_at");

-- AddForeignKey
ALTER TABLE "order_reviews" ADD CONSTRAINT "fk_order_reviews__order_line_id" FOREIGN KEY ("order_line_id") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_reviews" ADD CONSTRAINT "fk_order_reviews__replied_by" FOREIGN KEY ("replied_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "fk_claims__guarantee_policy_version_id" FOREIGN KEY ("guarantee_policy_version_id") REFERENCES "guarantee_policy_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "fk_claims__goodwill_memo_id" FOREIGN KEY ("goodwill_memo_id") REFERENCES "discount_memos"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "guarantee_policy_versions" ADD CONSTRAINT "fk_guarantee_policy_versions__approval_request_id" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "guarantee_policy_versions" ADD CONSTRAINT "fk_guarantee_policy_versions__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "guarantee_policy_rules" ADD CONSTRAINT "fk_guarantee_policy_rules__version_id" FOREIGN KEY ("version_id") REFERENCES "guarantee_policy_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Backfill (A-91): a review names its order's product line (an order has one).
UPDATE order_reviews r SET order_line_id = (
  SELECT l.id FROM order_lines l WHERE l.order_id = r.order_id AND l.line_type = 'product' ORDER BY l.line_no LIMIT 1
) WHERE r.order_line_id IS NULL;

-- Hand-written checks and triggers (A-91).
ALTER TABLE guarantee_policy_versions
  ADD CONSTRAINT ck_guarantee_policy_versions__version_no CHECK (version_no >= 1),
  ADD CONSTRAINT ck_guarantee_policy_versions__sla CHECK (response_business_days BETWEEN 0 AND 30 AND decision_business_days BETWEEN 0 AND 60),
  ADD CONSTRAINT ck_guarantee_policy_versions__reason CHECK (btrim(reason) <> ''),
  ADD CONSTRAINT ck_guarantee_policy_versions__proposed CHECK (status <> 'proposed' OR approval_request_id IS NOT NULL);
ALTER TABLE guarantee_policy_rules
  ADD CONSTRAINT ck_guarantee_policy_rules__no_goodwill CHECK (NOT ('goodwill' = ANY (remedies)));
ALTER TABLE claims
  ADD CONSTRAINT ck_claims__goodwill CHECK ((remedy = 'goodwill') = (goodwill_memo_id IS NOT NULL)),
  ADD CONSTRAINT ck_claims__approved_remedy CHECK (status NOT IN ('approved', 'resolved') OR decided_at < '2026-10-03' OR (severity IS NOT NULL AND remedy IS NOT NULL) OR liability = 'customer');
ALTER TABLE order_reviews
  ADD CONSTRAINT ck_order_reviews__reply CHECK ((reply_body IS NULL) = (replied_at IS NULL) AND (replied_at IS NULL) = (replied_by IS NULL));
-- D-260: rules of a version are written with it and never change; a version's terms never change either.
CREATE TRIGGER tg_guarantee_policy_rules__write_once BEFORE UPDATE OR DELETE ON guarantee_policy_rules
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE FUNCTION tg_guarantee_policy_versions__terms_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'guarantee policy versions are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.version_no <> OLD.version_no OR NEW.response_business_days <> OLD.response_business_days
     OR NEW.decision_business_days <> OLD.decision_business_days OR NEW.reason <> OLD.reason THEN
    RAISE EXCEPTION 'guarantee policy version % terms are frozen', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_guarantee_policy_versions__terms_frozen BEFORE UPDATE OR DELETE ON guarantee_policy_versions
  FOR EACH ROW EXECUTE FUNCTION tg_guarantee_policy_versions__terms_frozen();
