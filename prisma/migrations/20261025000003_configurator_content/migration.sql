-- U1 U-B0.1 slice 3 (schema-design A-51): storefront content of the offerable options (description, image; ink swatch),
-- pattern images, and the configurator's quantity limits and presets per catalogue product. All admin-maintained,
-- null / empty until set (nothing invented).

-- AlterTable
ALTER TABLE "assemblies" ADD COLUMN     "description_en" TEXT,
ADD COLUMN     "description_th" TEXT,
ADD COLUMN     "image_file_id" BIGINT;

-- AlterTable
ALTER TABLE "catalog_products" ADD COLUMN     "quantity_default" INTEGER,
ADD COLUMN     "quantity_max" INTEGER,
ADD COLUMN     "quantity_min" INTEGER,
ADD COLUMN     "quantity_presets" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "diecut_types" ADD COLUMN     "description_en" TEXT,
ADD COLUMN     "description_th" TEXT,
ADD COLUMN     "image_file_id" BIGINT;

-- AlterTable
ALTER TABLE "finishes" ADD COLUMN     "description_en" TEXT,
ADD COLUMN     "description_th" TEXT,
ADD COLUMN     "image_file_id" BIGINT;

-- AlterTable
ALTER TABLE "ink_colours" ADD COLUMN     "description_en" TEXT,
ADD COLUMN     "description_th" TEXT,
ADD COLUMN     "image_file_id" BIGINT,
ADD COLUMN     "swatch_hex" VARCHAR(7);

-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "description_en" TEXT,
ADD COLUMN     "description_th" TEXT,
ADD COLUMN     "image_file_id" BIGINT;

-- AlterTable
ALTER TABLE "patterns" ADD COLUMN     "description_en" TEXT,
ADD COLUMN     "description_th" TEXT,
ADD COLUMN     "image_file_id" BIGINT;

-- CreateIndex
CREATE INDEX "ix_assemblies__image_file_id" ON "assemblies"("image_file_id");

-- CreateIndex
CREATE INDEX "ix_diecut_types__image_file_id" ON "diecut_types"("image_file_id");

-- CreateIndex
CREATE INDEX "ix_finishes__image_file_id" ON "finishes"("image_file_id");

-- CreateIndex
CREATE INDEX "ix_ink_colours__image_file_id" ON "ink_colours"("image_file_id");

-- CreateIndex
CREATE INDEX "ix_materials__image_file_id" ON "materials"("image_file_id");

-- CreateIndex
CREATE INDEX "ix_patterns__image_file_id" ON "patterns"("image_file_id");

-- AddForeignKey
ALTER TABLE "patterns" ADD CONSTRAINT "fk_patterns__image_file_id" FOREIGN KEY ("image_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "fk_materials__image_file_id" FOREIGN KEY ("image_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "finishes" ADD CONSTRAINT "fk_finishes__image_file_id" FOREIGN KEY ("image_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ink_colours" ADD CONSTRAINT "fk_ink_colours__image_file_id" FOREIGN KEY ("image_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "diecut_types" ADD CONSTRAINT "fk_diecut_types__image_file_id" FOREIGN KEY ("image_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assemblies" ADD CONSTRAINT "fk_assemblies__image_file_id" FOREIGN KEY ("image_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written checks (not tracked by Prisma).
ALTER TABLE "catalog_products" ADD CONSTRAINT "ck_catalog_products__quantity_limits" CHECK (
  (quantity_min IS NULL OR quantity_min >= 1)
  AND (quantity_max IS NULL OR quantity_max >= coalesce(quantity_min, 1))
  AND (quantity_default IS NULL OR (
        quantity_default >= coalesce(quantity_min, 1)
        AND (quantity_max IS NULL OR quantity_default <= quantity_max)))
  AND coalesce(cardinality(quantity_presets), 0) <= 10
  AND 1 <= ALL (coalesce(quantity_presets, ARRAY[]::INTEGER[]))
  AND (quantity_min IS NULL OR quantity_min <= ALL (coalesce(quantity_presets, ARRAY[]::INTEGER[])))
  AND (quantity_max IS NULL OR quantity_max >= ALL (coalesce(quantity_presets, ARRAY[]::INTEGER[])))
);
ALTER TABLE "ink_colours" ADD CONSTRAINT "ck_ink_colours__swatch_hex" CHECK (swatch_hex IS NULL OR swatch_hex ~ '^#[0-9A-F]{6}$');
