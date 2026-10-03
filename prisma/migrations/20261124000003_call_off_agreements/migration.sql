-- U2.7 (schema-design A-104; D-206, D-290): call-off agreements, their releases and the call_off quotation source.
-- CreateEnum
CREATE TYPE "call_off_status" AS ENUM ('pending_factory', 'active', 'declined', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "call_off_release_status" AS ENUM ('quoted', 'ordered', 'lapsed');

-- AlterEnum
ALTER TYPE "quote_source" ADD VALUE 'call_off';

-- CreateTable
CREATE TABLE "call_off_agreements" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "customer_user_id" BIGINT NOT NULL,
    "quote_id" BIGINT NOT NULL,
    "quote_option_id" BIGINT NOT NULL,
    "factory_id" BIGINT NOT NULL,
    "product_type_id" BIGINT NOT NULL,
    "committed_quantity" INTEGER NOT NULL,
    "min_release_quantity" INTEGER NOT NULL,
    "months" SMALLINT NOT NULL,
    "status" "call_off_status" NOT NULL DEFAULT 'pending_factory',
    "responded_at" TIMESTAMPTZ(6),
    "responded_by" BIGINT,
    "decline_reason" TEXT,
    "starts_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "lapsed_quantity" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_call_off_agreements" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_off_releases" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "agreement_id" BIGINT NOT NULL,
    "seq" SMALLINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "call_off_release_status" NOT NULL DEFAULT 'quoted',
    "quote_id" BIGINT NOT NULL,
    "order_id" BIGINT,
    "includes_one_offs" BOOLEAN NOT NULL,
    "created_by" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ordered_at" TIMESTAMPTZ(6),
    "lapsed_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_call_off_releases" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_call_off_agreements__public_id" ON "call_off_agreements"("public_id");

-- CreateIndex
CREATE INDEX "ix_call_off_agreements__customer_user_id" ON "call_off_agreements"("customer_user_id");

-- CreateIndex
CREATE INDEX "ix_call_off_agreements__quote_id" ON "call_off_agreements"("quote_id");

-- CreateIndex
CREATE INDEX "ix_call_off_agreements__quote_option_id" ON "call_off_agreements"("quote_option_id");

-- CreateIndex
CREATE INDEX "ix_call_off_agreements__factory_id__status" ON "call_off_agreements"("factory_id", "status");

-- CreateIndex
CREATE INDEX "ix_call_off_agreements__product_type_id" ON "call_off_agreements"("product_type_id");

-- CreateIndex
CREATE INDEX "ix_call_off_agreements__responded_by" ON "call_off_agreements"("responded_by");

-- CreateIndex
CREATE INDEX "ix_call_off_agreements__status__expires_at" ON "call_off_agreements"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "ux_call_off_releases__public_id" ON "call_off_releases"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_call_off_releases__quote_id" ON "call_off_releases"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_call_off_releases__order_id" ON "call_off_releases"("order_id");

-- CreateIndex
CREATE INDEX "ix_call_off_releases__created_by" ON "call_off_releases"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_call_off_releases__agreement_id__seq" ON "call_off_releases"("agreement_id", "seq");

-- AddForeignKey
ALTER TABLE "call_off_agreements" ADD CONSTRAINT "fk_call_off_agreements__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "call_off_agreements" ADD CONSTRAINT "fk_call_off_agreements__quote_id" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "call_off_agreements" ADD CONSTRAINT "fk_call_off_agreements__quote_option_id" FOREIGN KEY ("quote_option_id") REFERENCES "quote_options"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "call_off_agreements" ADD CONSTRAINT "fk_call_off_agreements__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "call_off_agreements" ADD CONSTRAINT "fk_call_off_agreements__product_type_id" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "call_off_agreements" ADD CONSTRAINT "fk_call_off_agreements__responded_by" FOREIGN KEY ("responded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "call_off_releases" ADD CONSTRAINT "fk_call_off_releases__agreement_id" FOREIGN KEY ("agreement_id") REFERENCES "call_off_agreements"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "call_off_releases" ADD CONSTRAINT "fk_call_off_releases__quote_id" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "call_off_releases" ADD CONSTRAINT "fk_call_off_releases__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "call_off_releases" ADD CONSTRAINT "fk_call_off_releases__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written checks (A-104).
ALTER TABLE call_off_agreements
  ADD CONSTRAINT ck_call_off_agreements__quantities CHECK (committed_quantity >= 1 AND min_release_quantity >= 1),
  ADD CONSTRAINT ck_call_off_agreements__months CHECK (months BETWEEN 1 AND 60),
  ADD CONSTRAINT ck_call_off_agreements__active CHECK (
    status <> 'active' OR (responded_at IS NOT NULL AND starts_at IS NOT NULL AND expires_at > starts_at)),
  ADD CONSTRAINT ck_call_off_agreements__ended CHECK (status NOT IN ('cancelled', 'expired') OR ended_at IS NOT NULL),
  ADD CONSTRAINT ck_call_off_agreements__declined CHECK (
    status <> 'declined' OR (responded_at IS NOT NULL AND decline_reason IS NOT NULL)),
  ADD CONSTRAINT ck_call_off_agreements__lapsed CHECK (lapsed_quantity IS NULL OR lapsed_quantity >= 0);
ALTER TABLE call_off_releases
  ADD CONSTRAINT ck_call_off_releases__quantity CHECK (quantity >= 1 AND seq >= 1),
  ADD CONSTRAINT ck_call_off_releases__ordered CHECK ((status = 'ordered') = (order_id IS NOT NULL));
