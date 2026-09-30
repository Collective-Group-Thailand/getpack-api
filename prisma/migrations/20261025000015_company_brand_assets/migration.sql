-- U1 U-B0.1 slice 11b (schema-design A-60): the company's brand asset library (D-227).

-- CreateEnum
CREATE TYPE "company_asset_kind" AS ENUM ('logo', 'guideline', 'font', 'artwork', 'other');

-- CreateTable
CREATE TABLE "company_brand_assets" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" BIGINT NOT NULL,
    "file_object_id" BIGINT NOT NULL,
    "kind" "company_asset_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,
    "removed_at" TIMESTAMPTZ(6),
    "removed_by" BIGINT,

    CONSTRAINT "pk_company_brand_assets" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_company_brand_assets__public_id" ON "company_brand_assets"("public_id");

-- CreateIndex
CREATE INDEX "ix_company_brand_assets__company_id" ON "company_brand_assets"("company_id");

-- CreateIndex
CREATE INDEX "ix_company_brand_assets__file_object_id" ON "company_brand_assets"("file_object_id");

-- CreateIndex
CREATE INDEX "ix_company_brand_assets__created_by" ON "company_brand_assets"("created_by");

-- CreateIndex
CREATE INDEX "ix_company_brand_assets__removed_by" ON "company_brand_assets"("removed_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_company_brand_assets__live_file" ON "company_brand_assets"("company_id", "file_object_id") WHERE (removed_at IS NULL);

-- AddForeignKey
ALTER TABLE "company_brand_assets" ADD CONSTRAINT "fk_company_brand_assets__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_brand_assets" ADD CONSTRAINT "fk_company_brand_assets__file_object_id" FOREIGN KEY ("file_object_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_brand_assets" ADD CONSTRAINT "fk_company_brand_assets__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_brand_assets" ADD CONSTRAINT "fk_company_brand_assets__removed_by" FOREIGN KEY ("removed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written checks.
ALTER TABLE "company_brand_assets" ADD CONSTRAINT "ck_company_brand_assets__name"
  CHECK (char_length(name) BETWEEN 1 AND 200);
ALTER TABLE "company_brand_assets" ADD CONSTRAINT "ck_company_brand_assets__removed"
  CHECK ((removed_at IS NULL) = (removed_by IS NULL));
