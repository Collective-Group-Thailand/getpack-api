-- U-B6 corrugate slice 7c (schema-design A-49): the difficulty level a catalogue product is priced at online.
-- Legacy's customer path hard-coded difficulty group 5 (port map quirk C9); null = the product is not priced online.

-- AlterTable
ALTER TABLE "catalog_products" ADD COLUMN     "default_difficulty_level_id" BIGINT;

-- CreateIndex
CREATE INDEX "ix_catalog_products__default_difficulty_level_id" ON "catalog_products"("default_difficulty_level_id");

-- AddForeignKey
ALTER TABLE "catalog_products" ADD CONSTRAINT "fk_catalog_products__default_difficulty_level_id" FOREIGN KEY ("default_difficulty_level_id") REFERENCES "difficulty_levels"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

