-- U2.7 (schema-design A-102; D-205, D-289): the tooling register, absorbed remakes and the PO tooling line.
-- CreateEnum
CREATE TYPE "tooling_kind" AS ENUM ('plates', 'die_block');

-- CreateEnum
CREATE TYPE "tooling_status" AS ENUM ('active', 'unusable');

-- AlterEnum
ALTER TYPE "po_line_type" ADD VALUE 'tooling';

-- CreateTable
CREATE TABLE "tooling_items" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "kind" "tooling_kind" NOT NULL,
    "spec_sha256" BYTEA NOT NULL,
    "artwork_sha256" BYTEA,
    "key_sha256" BYTEA NOT NULL,
    "status" "tooling_status" NOT NULL DEFAULT 'active',
    "source_order_id" BIGINT NOT NULL,
    "last_order_id" BIGINT NOT NULL,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_tooling_items" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tooling_remakes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "tooling_id" BIGINT NOT NULL,
    "production_job_id" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "buy_net_amount" DECIMAL(14,2) NOT NULL,
    "reported_by" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_tooling_remakes" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_tooling_items__public_id" ON "tooling_items"("public_id");

-- CreateIndex
CREATE INDEX "ix_tooling_items__spec_sha256" ON "tooling_items"("spec_sha256");

-- CreateIndex
CREATE INDEX "ix_tooling_items__source_order_id" ON "tooling_items"("source_order_id");

-- CreateIndex
CREATE INDEX "ix_tooling_items__last_order_id" ON "tooling_items"("last_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_tooling_items__factory_id__key" ON "tooling_items"("factory_id", "key_sha256");

-- CreateIndex
CREATE UNIQUE INDEX "ux_tooling_remakes__public_id" ON "tooling_remakes"("public_id");

-- CreateIndex
CREATE INDEX "ix_tooling_remakes__production_job_id" ON "tooling_remakes"("production_job_id");

-- CreateIndex
CREATE INDEX "ix_tooling_remakes__reported_by" ON "tooling_remakes"("reported_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_tooling_remakes__tooling_id__job" ON "tooling_remakes"("tooling_id", "production_job_id");

-- AddForeignKey
ALTER TABLE "tooling_items" ADD CONSTRAINT "fk_tooling_items__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tooling_items" ADD CONSTRAINT "fk_tooling_items__source_order_id" FOREIGN KEY ("source_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tooling_items" ADD CONSTRAINT "fk_tooling_items__last_order_id" FOREIGN KEY ("last_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tooling_remakes" ADD CONSTRAINT "fk_tooling_remakes__tooling_id" FOREIGN KEY ("tooling_id") REFERENCES "tooling_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tooling_remakes" ADD CONSTRAINT "fk_tooling_remakes__production_job_id" FOREIGN KEY ("production_job_id") REFERENCES "production_jobs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tooling_remakes" ADD CONSTRAINT "fk_tooling_remakes__reported_by" FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written checks and triggers (A-102).
ALTER TABLE tooling_items
  ADD CONSTRAINT ck_tooling_items__hashes CHECK (
    octet_length(spec_sha256) = 32 AND octet_length(key_sha256) = 32
    AND (artwork_sha256 IS NULL OR octet_length(artwork_sha256) = 32)),
  -- Plates are bound to the artwork, a die block to the specification only (D-289).
  ADD CONSTRAINT ck_tooling_items__artwork CHECK ((kind = 'plates') = (artwork_sha256 IS NOT NULL));
ALTER TABLE tooling_remakes
  ADD CONSTRAINT ck_tooling_remakes__amount CHECK (buy_net_amount >= 0),
  ADD CONSTRAINT ck_tooling_remakes__reason CHECK (length(btrim(reason)) BETWEEN 1 AND 1000);
CREATE TRIGGER tg_tooling_remakes__write_once BEFORE UPDATE OR DELETE ON tooling_remakes
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
