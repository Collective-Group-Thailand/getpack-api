-- D-436: storage-based pricing of factory and partner accounts (@collective/documents) — a daily usage snapshot per
-- factory account and the notices sent at 80 % / 100 % of its allowance. Data is never deleted or locked for being over.

-- CreateEnum
CREATE TYPE "storage_account_type" AS ENUM ('factory', 'partner');

-- CreateTable
CREATE TABLE "storage_usage_daily" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "factory_id" BIGINT NOT NULL,
    "account_type" "storage_account_type" NOT NULL,
    "day" DATE NOT NULL,
    "file_bytes" BIGINT NOT NULL,
    "record_counts" JSONB NOT NULL DEFAULT '{}',
    "counted_bytes" BIGINT NOT NULL,
    "allowance_bytes" BIGINT,
    "setting_version_ids" TEXT[],
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_storage_usage_daily" PRIMARY KEY ("id"),
    CONSTRAINT "ck_storage_usage_daily__bytes" CHECK ("file_bytes" >= 0 AND "counted_bytes" >= "file_bytes" AND ("allowance_bytes" IS NULL OR "allowance_bytes" >= 0))
);

-- CreateTable
CREATE TABLE "storage_notices" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "threshold_pct" SMALLINT NOT NULL,
    "crossed_on" DATE NOT NULL,
    "used_bytes" BIGINT NOT NULL,
    "allowance_bytes" BIGINT NOT NULL,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cleared_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_storage_notices" PRIMARY KEY ("id"),
    CONSTRAINT "ck_storage_notices__threshold_pct" CHECK ("threshold_pct" BETWEEN 1 AND 1000)
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_storage_usage_daily__factory_id__day" ON "storage_usage_daily"("factory_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "ux_storage_notices__public_id" ON "storage_notices"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_storage_notices__factory_id__threshold_pct__open" ON "storage_notices"("factory_id", "threshold_pct") WHERE (cleared_at IS NULL);

-- CreateIndex
CREATE INDEX "ix_storage_notices__factory_id__sent_at" ON "storage_notices"("factory_id", "sent_at" DESC);

-- AddForeignKey
ALTER TABLE "storage_usage_daily" ADD CONSTRAINT "fk_storage_usage_daily__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "storage_notices" ADD CONSTRAINT "fk_storage_notices__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
