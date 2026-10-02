-- U3.B2 (schema-design A-87; D-245, D-246): the style search document (names, codes, family, category, material
-- class, synonyms, use cases, a verified reference) with a trigram index, and customers' favourite styles.

-- AlterTable
ALTER TABLE "style_bases" ADD COLUMN     "search_document" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "style_favourites" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "user_id" BIGINT NOT NULL,
    "base_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_style_favourites" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_style_favourites__base_id" ON "style_favourites"("base_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_style_favourites__user_id__base_id" ON "style_favourites"("user_id", "base_id");

-- CreateIndex
CREATE INDEX "ix_style_bases__search_document_trgm" ON "style_bases" USING GIN ("search_document" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "style_favourites" ADD CONSTRAINT "fk_style_favourites__user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_favourites" ADD CONSTRAINT "fk_style_favourites__base_id" FOREIGN KEY ("base_id") REFERENCES "style_bases"("id") ON DELETE CASCADE ON UPDATE RESTRICT;



-- Hand-written (A-87): backfill the search document of bases imported before (the service keeps it current).
UPDATE style_bases b SET search_document = lower(concat_ws(' ',
  b.code, b.name_th, b.name_en, b.family, b.category, b.material_class,
  CASE WHEN b.reference_verified_at IS NOT NULL THEN b.reference_code END,
  (SELECT string_agg(s.term, ' ') FROM style_synonyms s WHERE s.base_id = b.id),
  (SELECT string_agg(u.code, ' ') FROM style_use_cases u WHERE u.base_id = b.id)));
