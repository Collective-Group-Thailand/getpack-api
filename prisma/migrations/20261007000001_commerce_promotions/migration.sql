-- B3.3 promotions, campaigns, coupons, redemptions, fingerprints and referral (docs/schema-design.md §3.6; D-053, D-136, D-154).

-- CreateEnum
CREATE TYPE "campaign_status" AS ENUM ('draft', 'scheduled', 'active', 'paused', 'exhausted', 'ended');

-- CreateEnum
CREATE TYPE "promotion_kind" AS ENUM ('coupon', 'automatic', 'referral');

-- CreateEnum
CREATE TYPE "stacking_mode" AS ENUM ('exclusive', 'stackable', 'best_of');

-- CreateEnum
CREATE TYPE "promotion_status" AS ENUM ('draft', 'active', 'paused', 'ended');

-- CreateEnum
CREATE TYPE "coupon_kind" AS ENUM ('single', 'bulk_unique', 'per_customer');

-- CreateEnum
CREATE TYPE "coupon_status" AS ENUM ('active', 'used_up', 'disabled');

-- CreateEnum
CREATE TYPE "redemption_status" AS ENUM ('reserved', 'applied', 'reversed');

-- CreateEnum
CREATE TYPE "fingerprint_kind" AS ENUM ('phone', 'address', 'card_token', 'device');

-- CreateEnum
CREATE TYPE "referral_status" AS ENUM ('pending', 'qualified', 'rewarded', 'rejected_fraud', 'under_review');

-- AlterTable
ALTER TABLE "cart_codes" ADD COLUMN     "coupon_code_id" BIGINT,
ADD COLUMN     "promotion_id" BIGINT;

-- AlterTable
ALTER TABLE "customer_profiles" ADD COLUMN     "referral_code" TEXT,
ADD COLUMN     "referred_by_user_id" BIGINT;

-- AlterTable
ALTER TABLE "order_discounts" ADD COLUMN     "campaign_id" BIGINT,
ADD COLUMN     "coupon_code_id" BIGINT,
ADD COLUMN     "promotion_id" BIGINT,
ADD COLUMN     "redemption_id" BIGINT;

-- CreateTable
CREATE TABLE "campaigns" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6),
    "budget_amount" DECIMAL(14,2),
    "spent_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "alert_threshold_pct" DECIMAL(7,4) NOT NULL,
    "alerted_at" TIMESTAMPTZ(6),
    "status" "campaign_status" NOT NULL DEFAULT 'draft',
    "goals" JSONB NOT NULL DEFAULT '{}',
    "owner_user_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_campaigns" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "campaign_id" BIGINT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "promotion_kind" NOT NULL,
    "priority" SMALLINT NOT NULL,
    "stacking" "stacking_mode" NOT NULL,
    "stack_group" TEXT,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6),
    "conditions" JSONB NOT NULL,
    "conditions_schema_version" SMALLINT NOT NULL DEFAULT 1,
    "benefit" JSONB NOT NULL,
    "benefit_schema_version" SMALLINT NOT NULL DEFAULT 1,
    "usage_limit_total" INTEGER,
    "usage_limit_per_customer" INTEGER,
    "budget_amount" DECIMAL(14,2),
    "spent_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "promotion_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_promotions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_batches" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "promotion_id" BIGINT NOT NULL,
    "kind" "coupon_kind" NOT NULL,
    "count" INTEGER NOT NULL,
    "prefix" TEXT,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,

    CONSTRAINT "pk_coupon_batches" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_codes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "promotion_id" BIGINT NOT NULL,
    "batch_id" BIGINT,
    "code" CITEXT NOT NULL,
    "assigned_user_id" BIGINT,
    "usage_limit" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "status" "coupon_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_coupon_codes" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_usage_counters" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "promotion_id" BIGINT NOT NULL,
    "customer_key" BIGINT NOT NULL DEFAULT 0,
    "used_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pk_promotion_usage_counters" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_redemptions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "promotion_id" BIGINT NOT NULL,
    "coupon_code_id" BIGINT,
    "campaign_id" BIGINT,
    "order_group_id" BIGINT NOT NULL,
    "customer_user_id" BIGINT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "capped_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "redemption_status" NOT NULL DEFAULT 'reserved',
    "snapshot" JSONB NOT NULL,
    "reserved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMPTZ(6),
    "reversed_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_promotion_redemptions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_saved_coupons" (
    "user_id" BIGINT NOT NULL,
    "coupon_code_id" BIGINT NOT NULL,
    "saved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_customer_saved_coupons" PRIMARY KEY ("user_id","coupon_code_id")
);

-- CreateTable
CREATE TABLE "identity_fingerprints" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "user_id" BIGINT NOT NULL,
    "kind" "fingerprint_kind" NOT NULL,
    "value_hash" BYTEA NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_identity_fingerprints" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_attributions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "referrer_user_id" BIGINT NOT NULL,
    "referee_user_id" BIGINT NOT NULL,
    "referral_code" TEXT NOT NULL,
    "attributed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "first_order_group_id" BIGINT,
    "status" "referral_status" NOT NULL DEFAULT 'pending',
    "fraud_flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approval_request_id" BIGINT,
    "qualified_at" TIMESTAMPTZ(6),
    "decided_at" TIMESTAMPTZ(6),
    "rewarded_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_referral_attributions" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_campaigns__public_id" ON "campaigns"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_campaigns__code" ON "campaigns"("code");

-- CreateIndex
CREATE INDEX "ix_campaigns__status__starts_at" ON "campaigns"("status", "starts_at");

-- CreateIndex
CREATE INDEX "ix_campaigns__entity_id" ON "campaigns"("entity_id");

-- CreateIndex
CREATE INDEX "ix_campaigns__owner_user_id" ON "campaigns"("owner_user_id");

-- CreateIndex
CREATE INDEX "ix_campaigns__created_by" ON "campaigns"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_promotions__public_id" ON "promotions"("public_id");

-- CreateIndex
CREATE INDEX "ix_promotions__status__kind__starts_at" ON "promotions"("status", "kind", "starts_at");

-- CreateIndex
CREATE INDEX "ix_promotions__entity_id" ON "promotions"("entity_id");

-- CreateIndex
CREATE INDEX "ix_promotions__campaign_id" ON "promotions"("campaign_id");

-- CreateIndex
CREATE INDEX "ix_promotions__created_by" ON "promotions"("created_by");

-- CreateIndex
CREATE INDEX "ix_promotions__updated_by" ON "promotions"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_coupon_batches__public_id" ON "coupon_batches"("public_id");

-- CreateIndex
CREATE INDEX "ix_coupon_batches__promotion_id" ON "coupon_batches"("promotion_id");

-- CreateIndex
CREATE INDEX "ix_coupon_batches__created_by" ON "coupon_batches"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_coupon_codes__public_id" ON "coupon_codes"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_coupon_codes__code" ON "coupon_codes"("code");

-- CreateIndex
CREATE INDEX "ix_coupon_codes__promotion_id" ON "coupon_codes"("promotion_id");

-- CreateIndex
CREATE INDEX "ix_coupon_codes__batch_id" ON "coupon_codes"("batch_id");

-- CreateIndex
CREATE INDEX "ix_coupon_codes__assigned_user_id" ON "coupon_codes"("assigned_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_promotion_usage_counters__promotion_id__customer_key" ON "promotion_usage_counters"("promotion_id", "customer_key");

-- CreateIndex
CREATE UNIQUE INDEX "ux_promotion_redemptions__public_id" ON "promotion_redemptions"("public_id");

-- CreateIndex
CREATE INDEX "ix_promotion_redemptions__order_group_id" ON "promotion_redemptions"("order_group_id");

-- CreateIndex
CREATE INDEX "ix_promotion_redemptions__coupon_code_id" ON "promotion_redemptions"("coupon_code_id");

-- CreateIndex
CREATE INDEX "ix_promotion_redemptions__campaign_id" ON "promotion_redemptions"("campaign_id");

-- CreateIndex
CREATE INDEX "ix_promotion_redemptions__customer_user_id" ON "promotion_redemptions"("customer_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_promotion_redemptions__promotion_id__order_group_id" ON "promotion_redemptions"("promotion_id", "order_group_id");

-- CreateIndex
CREATE INDEX "ix_customer_saved_coupons__coupon_code_id" ON "customer_saved_coupons"("coupon_code_id");

-- CreateIndex
CREATE INDEX "ix_identity_fingerprints__kind__value_hash" ON "identity_fingerprints"("kind", "value_hash");

-- CreateIndex
CREATE UNIQUE INDEX "ux_identity_fingerprints__user_id__kind__value_hash" ON "identity_fingerprints"("user_id", "kind", "value_hash");

-- CreateIndex
CREATE UNIQUE INDEX "ux_referral_attributions__public_id" ON "referral_attributions"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_referral_attributions__referee_user_id" ON "referral_attributions"("referee_user_id");

-- CreateIndex
CREATE INDEX "ix_referral_attributions__referrer_user_id__status" ON "referral_attributions"("referrer_user_id", "status");

-- CreateIndex
CREATE INDEX "ix_referral_attributions__first_order_group_id" ON "referral_attributions"("first_order_group_id");

-- CreateIndex
CREATE INDEX "ix_referral_attributions__approval_request_id" ON "referral_attributions"("approval_request_id");

-- CreateIndex
CREATE INDEX "ix_cart_codes__promotion_id" ON "cart_codes"("promotion_id");

-- CreateIndex
CREATE INDEX "ix_cart_codes__coupon_code_id" ON "cart_codes"("coupon_code_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_customer_profiles__referral_code" ON "customer_profiles"("referral_code");

-- CreateIndex
CREATE INDEX "ix_customer_profiles__referred_by_user_id" ON "customer_profiles"("referred_by_user_id");

-- CreateIndex
CREATE INDEX "ix_order_discounts__promotion_id" ON "order_discounts"("promotion_id");

-- CreateIndex
CREATE INDEX "ix_order_discounts__coupon_code_id" ON "order_discounts"("coupon_code_id");

-- CreateIndex
CREATE INDEX "ix_order_discounts__campaign_id" ON "order_discounts"("campaign_id");

-- CreateIndex
CREATE INDEX "ix_order_discounts__redemption_id" ON "order_discounts"("redemption_id");

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "fk_customer_profiles__referred_by_user_id" FOREIGN KEY ("referred_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "cart_codes" ADD CONSTRAINT "fk_cart_codes__promotion_id" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "cart_codes" ADD CONSTRAINT "fk_cart_codes__coupon_code_id" FOREIGN KEY ("coupon_code_id") REFERENCES "coupon_codes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_discounts" ADD CONSTRAINT "fk_order_discounts__promotion_id" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_discounts" ADD CONSTRAINT "fk_order_discounts__coupon_code_id" FOREIGN KEY ("coupon_code_id") REFERENCES "coupon_codes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_discounts" ADD CONSTRAINT "fk_order_discounts__campaign_id" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_discounts" ADD CONSTRAINT "fk_order_discounts__redemption_id" FOREIGN KEY ("redemption_id") REFERENCES "promotion_redemptions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "fk_campaigns__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "fk_campaigns__owner_user_id" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "fk_campaigns__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "fk_promotions__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "fk_promotions__campaign_id" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "fk_promotions__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "fk_promotions__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "coupon_batches" ADD CONSTRAINT "fk_coupon_batches__promotion_id" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "coupon_batches" ADD CONSTRAINT "fk_coupon_batches__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "coupon_codes" ADD CONSTRAINT "fk_coupon_codes__promotion_id" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "coupon_codes" ADD CONSTRAINT "fk_coupon_codes__batch_id" FOREIGN KEY ("batch_id") REFERENCES "coupon_batches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "coupon_codes" ADD CONSTRAINT "fk_coupon_codes__assigned_user_id" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "promotion_usage_counters" ADD CONSTRAINT "fk_promotion_usage_counters__promotion_id" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "fk_promotion_redemptions__promotion_id" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "fk_promotion_redemptions__coupon_code_id" FOREIGN KEY ("coupon_code_id") REFERENCES "coupon_codes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "fk_promotion_redemptions__campaign_id" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "fk_promotion_redemptions__order_group_id" FOREIGN KEY ("order_group_id") REFERENCES "order_groups"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "fk_promotion_redemptions__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_saved_coupons" ADD CONSTRAINT "fk_customer_saved_coupons__user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_saved_coupons" ADD CONSTRAINT "fk_customer_saved_coupons__coupon_code_id" FOREIGN KEY ("coupon_code_id") REFERENCES "coupon_codes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "identity_fingerprints" ADD CONSTRAINT "fk_identity_fingerprints__user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "referral_attributions" ADD CONSTRAINT "fk_referral_attributions__referrer_user_id" FOREIGN KEY ("referrer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "referral_attributions" ADD CONSTRAINT "fk_referral_attributions__referee_user_id" FOREIGN KEY ("referee_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "referral_attributions" ADD CONSTRAINT "fk_referral_attributions__first_order_group_id" FOREIGN KEY ("first_order_group_id") REFERENCES "order_groups"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "referral_attributions" ADD CONSTRAINT "fk_referral_attributions__approval_request_id" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- --- hand-written (Prisma cannot express these) --------------------------------------------------

ALTER TABLE customer_profiles
  ADD CONSTRAINT ck_customer_profiles__referral_code CHECK (referral_code IS NULL OR referral_code ~ '^[A-Z0-9]{6,12}$'),
  ADD CONSTRAINT ck_customer_profiles__referred_by CHECK (referred_by_user_id IS NULL OR referred_by_user_id <> user_id);

-- --- campaigns (D-154) ----------------------------------------------------------------------------
ALTER TABLE campaigns
  ADD CONSTRAINT ck_campaigns__code CHECK (code ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  ADD CONSTRAINT ck_campaigns__name CHECK (btrim(name) <> ''),
  ADD CONSTRAINT ck_campaigns__window CHECK (ends_at IS NULL OR ends_at > starts_at),
  ADD CONSTRAINT ck_campaigns__amounts CHECK (
    (budget_amount IS NULL OR budget_amount >= 0) AND spent_amount >= 0
    AND (budget_amount IS NULL OR spent_amount <= budget_amount)
  ),
  ADD CONSTRAINT ck_campaigns__alert CHECK (alert_threshold_pct BETWEEN 0 AND 100),
  ADD CONSTRAINT ck_campaigns__exhausted CHECK (status <> 'exhausted' OR budget_amount IS NOT NULL);

-- --- promotions (D-053) ---------------------------------------------------------------------------
ALTER TABLE promotions
  ADD CONSTRAINT ck_promotions__name CHECK (btrim(name) <> ''),
  ADD CONSTRAINT ck_promotions__priority CHECK (priority >= 0),
  ADD CONSTRAINT ck_promotions__window CHECK (ends_at IS NULL OR ends_at > starts_at),
  ADD CONSTRAINT ck_promotions__limits CHECK (
    (usage_limit_total IS NULL OR usage_limit_total > 0)
    AND (usage_limit_per_customer IS NULL OR usage_limit_per_customer > 0)
  ),
  ADD CONSTRAINT ck_promotions__amounts CHECK (
    (budget_amount IS NULL OR budget_amount >= 0) AND spent_amount >= 0
    AND (budget_amount IS NULL OR spent_amount <= budget_amount)
  ),
  ADD CONSTRAINT ck_promotions__schema_versions CHECK (conditions_schema_version > 0 AND benefit_schema_version > 0);

ALTER TABLE coupon_batches
  ADD CONSTRAINT ck_coupon_batches__count CHECK (count > 0),
  ADD CONSTRAINT ck_coupon_batches__prefix CHECK (prefix IS NULL OR prefix ~ '^[A-Z0-9]{1,12}$');
CREATE TRIGGER tg_coupon_batches__append_only BEFORE UPDATE OR DELETE ON coupon_batches
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_row_change();

ALTER TABLE coupon_codes
  ADD CONSTRAINT ck_coupon_codes__code CHECK (code ~ '^[A-Za-z0-9-]{3,40}$'),
  ADD CONSTRAINT ck_coupon_codes__usage CHECK (
    used_count >= 0 AND (usage_limit IS NULL OR (usage_limit > 0 AND used_count <= usage_limit))
  );

ALTER TABLE promotion_usage_counters
  ADD CONSTRAINT ck_promotion_usage_counters__values CHECK (used_count >= 0 AND customer_key >= 0);

ALTER TABLE promotion_redemptions
  ADD CONSTRAINT ck_promotion_redemptions__amounts CHECK (amount >= 0 AND capped_amount >= 0),
  ADD CONSTRAINT ck_promotion_redemptions__applied CHECK (status <> 'applied' OR applied_at IS NOT NULL),
  ADD CONSTRAINT ck_promotion_redemptions__reversed CHECK ((status = 'reversed') = (reversed_at IS NOT NULL));
CREATE TRIGGER tg_promotion_redemptions__no_delete BEFORE DELETE ON promotion_redemptions
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE identity_fingerprints
  ADD CONSTRAINT ck_identity_fingerprints__hash CHECK (octet_length(value_hash) = 32);

ALTER TABLE referral_attributions
  ADD CONSTRAINT ck_referral_attributions__self CHECK (referrer_user_id <> referee_user_id),
  ADD CONSTRAINT ck_referral_attributions__code CHECK (btrim(referral_code) <> ''),
  ADD CONSTRAINT ck_referral_attributions__qualified CHECK (
    status NOT IN ('qualified', 'rewarded') OR qualified_at IS NOT NULL
  ),
  ADD CONSTRAINT ck_referral_attributions__rewarded CHECK ((status = 'rewarded') = (rewarded_at IS NOT NULL));
