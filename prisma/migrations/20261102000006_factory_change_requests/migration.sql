-- U1 U-B0.3 slice 12b (schema-design A-69): a factory asks the Partner team for a change only staff may make, or a site visit; staff answer it.

-- CreateEnum
CREATE TYPE "factory_change_request_topic" AS ENUM ('capability', 'capacity', 'delivery_zones', 'tolerance', 'participation_tier', 'pricing_arrangement', 'payout_policy', 'site_visit', 'other');

-- CreateEnum
CREATE TYPE "factory_change_request_status" AS ENUM ('open', 'in_progress', 'done', 'declined');

-- CreateTable
CREATE TABLE "factory_change_requests" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "topic" "factory_change_request_topic" NOT NULL,
    "message" TEXT NOT NULL,
    "preferred_dates" DATE[] DEFAULT ARRAY[]::DATE[],
    "status" "factory_change_request_status" NOT NULL DEFAULT 'open',
    "response" TEXT,
    "responded_at" TIMESTAMPTZ(6),
    "responded_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_factory_change_requests" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_factory_change_requests__public_id" ON "factory_change_requests"("public_id");

-- CreateIndex
CREATE INDEX "ix_factory_change_requests__factory_id__status" ON "factory_change_requests"("factory_id", "status");

-- CreateIndex
CREATE INDEX "ix_factory_change_requests__status__created_at" ON "factory_change_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "ix_factory_change_requests__responded_by" ON "factory_change_requests"("responded_by");

-- CreateIndex
CREATE INDEX "ix_factory_change_requests__created_by" ON "factory_change_requests"("created_by");

-- AddForeignKey
ALTER TABLE "factory_change_requests" ADD CONSTRAINT "fk_factory_change_requests__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "factory_change_requests" ADD CONSTRAINT "fk_factory_change_requests__responded_by" FOREIGN KEY ("responded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "factory_change_requests" ADD CONSTRAINT "fk_factory_change_requests__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- Hand-written (A-69)
ALTER TABLE factory_change_requests
  ADD CONSTRAINT ck_factory_change_requests__message CHECK (btrim(message) <> '' AND char_length(message) <= 2000),
  ADD CONSTRAINT ck_factory_change_requests__site_visit CHECK (topic <> 'site_visit' OR cardinality(preferred_dates) > 0),
  ADD CONSTRAINT ck_factory_change_requests__answered CHECK (
    (status IN ('done', 'declined')) <= (responded_at IS NOT NULL AND responded_by IS NOT NULL
      AND response IS NOT NULL AND btrim(response) <> ''));
