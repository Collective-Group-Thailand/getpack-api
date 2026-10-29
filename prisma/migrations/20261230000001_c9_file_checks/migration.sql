-- C9 (upload redesign Phase 1 → 2, D-457): the own-file check before ordering. A customer uploads PDF / AI files on
-- /studio/upload; each version is read (facts), its die lines matched to a product and standard size, checked with
-- the 12 checks (the shared preflight engine, ADR-0009) and, once nothing blocks, carted with the file — the checked
-- file becomes the order's artwork when the order is placed.

-- AlterEnum: the rest of the 12 checks (one engine for the pre-check, the order's submissions and the Studio file)
ALTER TYPE "preflight_check" ADD VALUE 'ink_count';
ALTER TYPE "preflight_check" ADD VALUE 'small_text';
ALTER TYPE "preflight_check" ADD VALUE 'small_text_black';
ALTER TYPE "preflight_check" ADD VALUE 'barcode';
ALTER TYPE "preflight_check" ADD VALUE 'die_layer';

-- CreateEnum
CREATE TYPE "file_check_status" AS ENUM ('queued', 'running', 'done', 'failed');

-- CreateTable
CREATE TABLE "file_checks" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "customer_user_id" BIGINT NOT NULL,
    "catalog_product_id" BIGINT,
    "standard_size_code" TEXT,
    "print_method" TEXT,
    "print_spot_colours" SMALLINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_file_checks" PRIMARY KEY ("id"),
    CONSTRAINT "ck_file_checks__print_method" CHECK ("print_method" IS NULL OR "print_method" IN ('none', 'spot', 'cmyk'))
);

-- CreateTable
CREATE TABLE "file_check_versions" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "file_check_id" BIGINT NOT NULL,
    "variant_no" SMALLINT NOT NULL,
    "version_no" SMALLINT NOT NULL,
    "file_object_id" BIGINT NOT NULL,
    "status" "file_check_status" NOT NULL DEFAULT 'queued',
    "stage" SMALLINT NOT NULL DEFAULT 0,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "facts" JSONB,
    "detection" JSONB,
    "report" JSONB,
    "refs" JSONB,
    "error" TEXT,
    "removed_at" TIMESTAMPTZ(6),
    "cart_item_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_file_check_versions" PRIMARY KEY ("id"),
    CONSTRAINT "ck_file_check_versions__numbers" CHECK ("variant_no" >= 1 AND "version_no" >= 1 AND "stage" BETWEEN 0 AND 5)
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_file_checks__public_id" ON "file_checks"("public_id");
CREATE INDEX "ix_file_checks__customer_user_id__created_at" ON "file_checks"("customer_user_id", "created_at");
CREATE INDEX "ix_file_checks__catalog_product_id" ON "file_checks"("catalog_product_id");
CREATE UNIQUE INDEX "ux_file_check_versions__public_id" ON "file_check_versions"("public_id");
CREATE UNIQUE INDEX "ux_file_check_versions__cart_item_id" ON "file_check_versions"("cart_item_id");
CREATE UNIQUE INDEX "ux_file_check_versions__file_check_id__variant_no__version_no" ON "file_check_versions"("file_check_id", "variant_no", "version_no");
CREATE INDEX "ix_file_check_versions__file_object_id" ON "file_check_versions"("file_object_id");
CREATE INDEX "ix_file_check_versions__queue" ON "file_check_versions"("status", "locked_until") WHERE (status = ANY (ARRAY['queued'::file_check_status, 'running'::file_check_status]));

-- AddForeignKey
ALTER TABLE "file_checks" ADD CONSTRAINT "fk_file_checks__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "file_checks" ADD CONSTRAINT "fk_file_checks__catalog_product_id" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "file_check_versions" ADD CONSTRAINT "fk_file_check_versions__file_check_id" FOREIGN KEY ("file_check_id") REFERENCES "file_checks"("id") ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "file_check_versions" ADD CONSTRAINT "fk_file_check_versions__file_object_id" FOREIGN KEY ("file_object_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "file_check_versions" ADD CONSTRAINT "fk_file_check_versions__cart_item_id" FOREIGN KEY ("cart_item_id") REFERENCES "cart_items"("id") ON DELETE SET NULL ON UPDATE RESTRICT;
