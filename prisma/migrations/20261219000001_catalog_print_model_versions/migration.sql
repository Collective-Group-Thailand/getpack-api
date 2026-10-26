-- B-API-6 (D-443, ADR-0005): the per-side print model of a catalogue product becomes effective-dated. Each admin change
-- (`PUT /v1/admin/catalog/catalog-products/{id}/print-model`) adds a version; reads use the version in force (greatest
-- `effective_from <= now`, ties: greatest `version_no`). `model` NULL = no model from that date.

CREATE TABLE "catalog_product_print_models" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "catalog_product_id" BIGINT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "model" JSONB,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,

    CONSTRAINT "pk_catalog_product_print_models" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ux_catalog_product_print_models__public_id" ON "catalog_product_print_models"("public_id");
CREATE INDEX "ix_catalog_product_print_models__product_effective" ON "catalog_product_print_models"("catalog_product_id", "effective_from");
CREATE INDEX "ix_catalog_product_print_models__created_by" ON "catalog_product_print_models"("created_by");
CREATE UNIQUE INDEX "ux_catalog_product_print_models__product_version" ON "catalog_product_print_models"("catalog_product_id", "version_no");

ALTER TABLE "catalog_product_print_models" ADD CONSTRAINT "fk_catalog_product_print_models__catalog_product_id" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "catalog_product_print_models" ADD CONSTRAINT "fk_catalog_product_print_models__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Existing models become version 1, in force since the product was last changed (already in force today).
INSERT INTO "catalog_product_print_models" ("catalog_product_id", "version_no", "model", "effective_from", "created_by")
SELECT "id", 1, "print_model", LEAST("updated_at", CURRENT_TIMESTAMP), "updated_by"
FROM "catalog_products"
WHERE "print_model" IS NOT NULL;

ALTER TABLE "catalog_products" DROP COLUMN "print_model";
