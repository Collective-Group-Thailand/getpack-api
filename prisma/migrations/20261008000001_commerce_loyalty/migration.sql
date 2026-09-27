-- CreateEnum
CREATE TYPE "loyalty_tier" AS ENUM ('member', 'silver', 'gold');

-- CreateEnum
CREATE TYPE "points_entry_type" AS ENUM ('earn_order', 'earn_signup', 'earn_line_link', 'earn_review', 'earn_referral', 'earn_bonus', 'redeem', 'redeem_reversal', 'reversal_claim_refund', 'expire', 'adjust');

-- CreateEnum
CREATE TYPE "points_status" AS ENUM ('pending', 'available', 'expired', 'reversed');

-- CreateEnum
CREATE TYPE "review_status" AS ENUM ('pending', 'published', 'hidden');

-- CreateTable
CREATE TABLE "loyalty_memberships" (
    "user_id" BIGINT NOT NULL,
    "tier" "loyalty_tier" NOT NULL DEFAULT 'member',
    "spend_12m" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "multiplier" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "tiers_setting_version_id" BIGINT,
    "evaluated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_loyalty_memberships" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "points_ledger" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" BIGINT NOT NULL,
    "entry_type" "points_entry_type" NOT NULL,
    "points" INTEGER NOT NULL,
    "point_value" DECIMAL(18,6) NOT NULL,
    "point_value_setting_version_id" BIGINT,
    "baht_value" DECIMAL(14,2) NOT NULL,
    "status" "points_status" NOT NULL,
    "available_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "order_id" BIGINT,
    "order_group_id" BIGINT,
    "review_id" BIGINT,
    "referral_attribution_id" BIGINT,
    "reverses_entry_id" BIGINT,
    "reason" TEXT,
    "domain_event_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,

    CONSTRAINT "pk_points_ledger" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "points_lots" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "earn_entry_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "points" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "reminded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_points_lots" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "points_lot_consumptions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "lot_id" BIGINT NOT NULL,
    "consuming_entry_id" BIGINT NOT NULL,
    "points" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_points_lot_consumptions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_reviews" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "rating" SMALLINT NOT NULL,
    "comment" TEXT,
    "status" "review_status" NOT NULL DEFAULT 'published',
    "moderated_by" BIGINT,
    "moderated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_order_reviews" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_loyalty_memberships__tiers_setting_version_id" ON "loyalty_memberships"("tiers_setting_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_points_ledger__public_id" ON "points_ledger"("public_id");

-- CreateIndex
CREATE INDEX "ix_points_ledger__user_id__created_at" ON "points_ledger"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_points_ledger__pending" ON "points_ledger"("available_at") WHERE (status = 'pending'::points_status);

-- CreateIndex
CREATE INDEX "ix_points_ledger__point_value_setting_version_id" ON "points_ledger"("point_value_setting_version_id");

-- CreateIndex
CREATE INDEX "ix_points_ledger__order_id" ON "points_ledger"("order_id");

-- CreateIndex
CREATE INDEX "ix_points_ledger__order_group_id" ON "points_ledger"("order_group_id");

-- CreateIndex
CREATE INDEX "ix_points_ledger__review_id" ON "points_ledger"("review_id");

-- CreateIndex
CREATE INDEX "ix_points_ledger__referral_attribution_id" ON "points_ledger"("referral_attribution_id");

-- CreateIndex
CREATE INDEX "ix_points_ledger__reverses_entry_id" ON "points_ledger"("reverses_entry_id");

-- CreateIndex
CREATE INDEX "ix_points_ledger__created_by" ON "points_ledger"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_points_ledger__one_off_rewards" ON "points_ledger"("user_id", "entry_type") WHERE (entry_type = ANY (ARRAY['earn_signup'::points_entry_type, 'earn_line_link'::points_entry_type]));

-- CreateIndex
CREATE UNIQUE INDEX "ux_points_ledger__review_reward" ON "points_ledger"("review_id") WHERE (entry_type = 'earn_review'::points_entry_type);

-- CreateIndex
CREATE UNIQUE INDEX "ux_points_ledger__order_earning" ON "points_ledger"("order_id", "entry_type") WHERE (entry_type = 'earn_order'::points_entry_type);

-- CreateIndex
CREATE UNIQUE INDEX "ux_points_ledger__referral_reward" ON "points_ledger"("referral_attribution_id") WHERE (entry_type = 'earn_referral'::points_entry_type);

-- CreateIndex
CREATE UNIQUE INDEX "ux_points_ledger__group_redemption" ON "points_ledger"("order_group_id") WHERE (entry_type = 'redeem'::points_entry_type);

-- CreateIndex
CREATE UNIQUE INDEX "ux_points_lots__earn_entry_id" ON "points_lots"("earn_entry_id");

-- CreateIndex
CREATE INDEX "ix_points_lots__open" ON "points_lots"("user_id", "expires_at") WHERE (remaining > 0);

-- CreateIndex
CREATE INDEX "ix_points_lot_consumptions__lot_id" ON "points_lot_consumptions"("lot_id");

-- CreateIndex
CREATE INDEX "ix_points_lot_consumptions__consuming_entry_id" ON "points_lot_consumptions"("consuming_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_order_reviews__public_id" ON "order_reviews"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_order_reviews__order_id" ON "order_reviews"("order_id");

-- CreateIndex
CREATE INDEX "ix_order_reviews__user_id" ON "order_reviews"("user_id");

-- CreateIndex
CREATE INDEX "ix_order_reviews__moderated_by" ON "order_reviews"("moderated_by");

-- AddForeignKey
ALTER TABLE "loyalty_memberships" ADD CONSTRAINT "fk_loyalty_memberships__user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "loyalty_memberships" ADD CONSTRAINT "fk_loyalty_memberships__tiers_setting_version_id" FOREIGN KEY ("tiers_setting_version_id") REFERENCES "setting_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "points_ledger" ADD CONSTRAINT "fk_points_ledger__user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "points_ledger" ADD CONSTRAINT "fk_points_ledger__point_value_setting_version_id" FOREIGN KEY ("point_value_setting_version_id") REFERENCES "setting_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "points_ledger" ADD CONSTRAINT "fk_points_ledger__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "points_ledger" ADD CONSTRAINT "fk_points_ledger__order_group_id" FOREIGN KEY ("order_group_id") REFERENCES "order_groups"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "points_ledger" ADD CONSTRAINT "fk_points_ledger__review_id" FOREIGN KEY ("review_id") REFERENCES "order_reviews"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "points_ledger" ADD CONSTRAINT "fk_points_ledger__referral_attribution_id" FOREIGN KEY ("referral_attribution_id") REFERENCES "referral_attributions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "points_ledger" ADD CONSTRAINT "fk_points_ledger__reverses_entry_id" FOREIGN KEY ("reverses_entry_id") REFERENCES "points_ledger"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "points_ledger" ADD CONSTRAINT "fk_points_ledger__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "points_lots" ADD CONSTRAINT "fk_points_lots__earn_entry_id" FOREIGN KEY ("earn_entry_id") REFERENCES "points_ledger"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "points_lots" ADD CONSTRAINT "fk_points_lots__user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "points_lot_consumptions" ADD CONSTRAINT "fk_points_lot_consumptions__lot_id" FOREIGN KEY ("lot_id") REFERENCES "points_lots"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "points_lot_consumptions" ADD CONSTRAINT "fk_points_lot_consumptions__consuming_entry_id" FOREIGN KEY ("consuming_entry_id") REFERENCES "points_ledger"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_reviews" ADD CONSTRAINT "fk_order_reviews__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_reviews" ADD CONSTRAINT "fk_order_reviews__user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_reviews" ADD CONSTRAINT "fk_order_reviews__moderated_by" FOREIGN KEY ("moderated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- =====================================================================================================
-- Hand-written: loyalty guards (D-130…D-135, schema-design §3.6 / A-34)
-- =====================================================================================================

ALTER TABLE loyalty_memberships
  ADD CONSTRAINT ck_loyalty_memberships__values CHECK (spend_12m >= 0 AND multiplier > 0);

-- --- points ledger: append-only; only an earning's status moves forward -----------------------------
ALTER TABLE points_ledger
  ADD CONSTRAINT ck_points_ledger__points CHECK (points <> 0),
  ADD CONSTRAINT ck_points_ledger__sign CHECK (
    CASE
      WHEN entry_type IN ('earn_order', 'earn_signup', 'earn_line_link', 'earn_review', 'earn_referral', 'earn_bonus', 'redeem_reversal')
        THEN points > 0
      WHEN entry_type IN ('redeem', 'reversal_claim_refund', 'expire') THEN points < 0
      ELSE TRUE
    END
  ),
  ADD CONSTRAINT ck_points_ledger__values CHECK (point_value > 0 AND baht_value >= 0),
  ADD CONSTRAINT ck_points_ledger__status CHECK (
    entry_type::text LIKE 'earn\_%' OR status = 'available'
  ),
  ADD CONSTRAINT ck_points_ledger__pending CHECK (status <> 'pending' OR available_at IS NOT NULL),
  ADD CONSTRAINT ck_points_ledger__adjust_reason CHECK (entry_type <> 'adjust' OR btrim(coalesce(reason, '')) <> '');

CREATE FUNCTION tg_points_ledger__guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'points_ledger rows are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.id, NEW.public_id, NEW.user_id, NEW.entry_type, NEW.points, NEW.point_value,
      NEW.point_value_setting_version_id, NEW.baht_value, NEW.order_id, NEW.order_group_id, NEW.review_id,
      NEW.referral_attribution_id, NEW.reverses_entry_id, NEW.reason, NEW.domain_event_id, NEW.created_at,
      NEW.created_by)
     IS DISTINCT FROM
     (OLD.id, OLD.public_id, OLD.user_id, OLD.entry_type, OLD.points, OLD.point_value,
      OLD.point_value_setting_version_id, OLD.baht_value, OLD.order_id, OLD.order_group_id, OLD.review_id,
      OLD.referral_attribution_id, OLD.reverses_entry_id, OLD.reason, OLD.domain_event_id, OLD.created_at,
      OLD.created_by) THEN
    RAISE EXCEPTION 'points_ledger is append-only (only an earning''s status may move)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'pending' AND NEW.status IN ('available', 'reversed'))
    OR (OLD.status = 'available' AND NEW.status = 'expired')
  ) THEN
    RAISE EXCEPTION 'points status % → % is not allowed', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'pending' AND (NEW.available_at, NEW.expires_at) IS DISTINCT FROM (OLD.available_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'dates of a credited points entry are fixed' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_points_ledger__guard BEFORE UPDATE OR DELETE ON points_ledger
  FOR EACH ROW EXECUTE FUNCTION tg_points_ledger__guard();

-- --- lots and consumptions -------------------------------------------------------------------------
ALTER TABLE points_lots
  ADD CONSTRAINT ck_points_lots__remaining CHECK (points > 0 AND remaining >= 0 AND remaining <= points);
CREATE TRIGGER tg_points_lots__no_delete BEFORE DELETE ON points_lots
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE points_lot_consumptions
  ADD CONSTRAINT ck_points_lot_consumptions__points CHECK (points <> 0);
CREATE TRIGGER tg_points_lot_consumptions__append_only BEFORE UPDATE OR DELETE ON points_lot_consumptions
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_row_change();

-- --- reviews ------------------------------------------------------------------------------------------
ALTER TABLE order_reviews
  ADD CONSTRAINT ck_order_reviews__rating CHECK (rating BETWEEN 1 AND 5),
  ADD CONSTRAINT ck_order_reviews__comment CHECK (comment IS NULL OR length(comment) <= 2000),
  ADD CONSTRAINT ck_order_reviews__moderated CHECK ((moderated_by IS NULL) = (moderated_at IS NULL));
CREATE TRIGGER tg_order_reviews__no_delete BEFORE DELETE ON order_reviews
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();
