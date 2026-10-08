-- UX round 2 Phase 4 §A5 (2026-10-07, D-311): customer stories on the home page. A story is shown only while
-- approved with the customer's written permission on file (a private file, never served publicly); approval records
-- who and when. Consent and approval live in their own table, not in CMS JSON (PDPA).
-- CreateEnum
CREATE TYPE "home_case_status" AS ENUM ('draft', 'approved', 'withdrawn');

-- CreateTable
CREATE TABLE "home_customer_cases" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "brand_name_th" TEXT NOT NULL,
    "province_th" TEXT NOT NULL,
    "product_th" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lead_time_days" INTEGER NOT NULL,
    "quote_th" TEXT NOT NULL,
    "photo_file_id" BIGINT,
    "consent_file_id" BIGINT,
    "status" "home_case_status" NOT NULL DEFAULT 'draft',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "approved_by" BIGINT,
    "approved_at" TIMESTAMPTZ(6),
    "withdrawn_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_home_customer_cases" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_home_customer_cases__public_id" ON "home_customer_cases"("public_id");

-- CreateIndex
CREATE INDEX "ix_home_customer_cases__status__sort" ON "home_customer_cases"("status", "sort");

-- CreateIndex
CREATE INDEX "ix_home_customer_cases__photo_file_id" ON "home_customer_cases"("photo_file_id");

-- CreateIndex
CREATE INDEX "ix_home_customer_cases__consent_file_id" ON "home_customer_cases"("consent_file_id");

-- CreateIndex
CREATE INDEX "ix_home_customer_cases__approved_by" ON "home_customer_cases"("approved_by");

-- CreateIndex
CREATE INDEX "ix_home_customer_cases__created_by" ON "home_customer_cases"("created_by");

-- CreateIndex
CREATE INDEX "ix_home_customer_cases__updated_by" ON "home_customer_cases"("updated_by");

-- AddForeignKey
ALTER TABLE "home_customer_cases" ADD CONSTRAINT "fk_home_customer_cases__photo_file_id" FOREIGN KEY ("photo_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "home_customer_cases" ADD CONSTRAINT "fk_home_customer_cases__consent_file_id" FOREIGN KEY ("consent_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "home_customer_cases" ADD CONSTRAINT "fk_home_customer_cases__approved_by" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "home_customer_cases" ADD CONSTRAINT "fk_home_customer_cases__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "home_customer_cases" ADD CONSTRAINT "fk_home_customer_cases__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written checks (D-311).
ALTER TABLE "home_customer_cases"
  ADD CONSTRAINT ck_home_customer_cases__texts CHECK (
    btrim(brand_name_th) <> '' AND btrim(province_th) <> '' AND btrim(product_th) <> '' AND btrim(quote_th) <> ''),
  ADD CONSTRAINT ck_home_customer_cases__figures CHECK (quantity > 0 AND lead_time_days > 0 AND sort >= 0),
  ADD CONSTRAINT ck_home_customer_cases__approved CHECK (
    status <> 'approved'
    OR (consent_file_id IS NOT NULL AND photo_file_id IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  ADD CONSTRAINT ck_home_customer_cases__withdrawn CHECK ((status = 'withdrawn') = (withdrawn_at IS NOT NULL));
