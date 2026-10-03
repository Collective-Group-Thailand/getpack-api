-- U2.7 (schema-design A-105; D-207, D-291): company API clients, webhook subscriptions and their deliveries.
-- CreateEnum
CREATE TYPE "webhook_subscription_status" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "webhook_delivery_status" AS ENUM ('pending', 'delivered', 'failed');

-- AlterTable
ALTER TABLE "api_clients" ADD COLUMN     "company_id" BIGINT,
ADD COLUMN     "owner_user_id" BIGINT;

-- CreateTable
CREATE TABLE "webhook_subscriptions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" BIGINT NOT NULL,
    "url" TEXT NOT NULL,
    "event_types" TEXT[],
    "secret_enc" BYTEA NOT NULL,
    "status" "webhook_subscription_status" NOT NULL DEFAULT 'active',
    "created_by_client_id" BIGINT NOT NULL,
    "disabled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_webhook_subscriptions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "subscription_id" BIGINT NOT NULL,
    "domain_event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "status" "webhook_delivery_status" NOT NULL DEFAULT 'pending',
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "last_attempt_at" TIMESTAMPTZ(6),
    "last_status_code" SMALLINT,
    "last_error" TEXT,
    "delivered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_webhook_deliveries" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_webhook_subscriptions__public_id" ON "webhook_subscriptions"("public_id");

-- CreateIndex
CREATE INDEX "ix_webhook_subscriptions__company_id__status" ON "webhook_subscriptions"("company_id", "status");

-- CreateIndex
CREATE INDEX "ix_webhook_subscriptions__created_by_client_id" ON "webhook_subscriptions"("created_by_client_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_webhook_deliveries__public_id" ON "webhook_deliveries"("public_id");

-- CreateIndex
CREATE INDEX "ix_webhook_deliveries__status__next_attempt_at" ON "webhook_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "ix_webhook_deliveries__domain_event_id" ON "webhook_deliveries"("domain_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_webhook_deliveries__subscription__event__type" ON "webhook_deliveries"("subscription_id", "domain_event_id", "event_type");

-- CreateIndex
CREATE INDEX "ix_api_clients__company_id" ON "api_clients"("company_id");

-- CreateIndex
CREATE INDEX "ix_api_clients__owner_user_id" ON "api_clients"("owner_user_id");

-- AddForeignKey
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "fk_webhook_subscriptions__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "fk_webhook_subscriptions__created_by_client_id" FOREIGN KEY ("created_by_client_id") REFERENCES "api_clients"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "fk_webhook_deliveries__subscription_id" FOREIGN KEY ("subscription_id") REFERENCES "webhook_subscriptions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "fk_webhook_deliveries__domain_event_id" FOREIGN KEY ("domain_event_id") REFERENCES "domain_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "api_clients" ADD CONSTRAINT "fk_api_clients__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "api_clients" ADD CONSTRAINT "fk_api_clients__owner_user_id" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written checks (A-105).
ALTER TABLE api_clients
  ADD CONSTRAINT ck_api_clients__one_scope CHECK (factory_id IS NULL OR company_id IS NULL),
  ADD CONSTRAINT ck_api_clients__company_owner CHECK ((company_id IS NULL) = (owner_user_id IS NULL));
ALTER TABLE webhook_subscriptions
  ADD CONSTRAINT ck_webhook_subscriptions__url CHECK (url ~ '^https://' AND length(url) <= 2000),
  ADD CONSTRAINT ck_webhook_subscriptions__events CHECK (cardinality(event_types) >= 1),
  ADD CONSTRAINT ck_webhook_subscriptions__disabled CHECK ((status = 'disabled') = (disabled_at IS NOT NULL));
ALTER TABLE webhook_deliveries
  ADD CONSTRAINT ck_webhook_deliveries__body CHECK (jsonb_typeof(body) = 'object'),
  ADD CONSTRAINT ck_webhook_deliveries__attempts CHECK (attempts >= 0),
  ADD CONSTRAINT ck_webhook_deliveries__delivered CHECK ((status = 'delivered') = (delivered_at IS NOT NULL)),
  ADD CONSTRAINT ck_webhook_deliveries__pending CHECK (status <> 'pending' OR next_attempt_at IS NOT NULL);
