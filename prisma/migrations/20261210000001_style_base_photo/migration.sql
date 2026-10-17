-- D-426: a style's photo — a photograph or an AI render of the type — shown on its cards before the engine's
-- thumbnails. `photo_meta` holds `{ source, alt: { th, en } }`.
ALTER TABLE "style_bases"
  ADD COLUMN "photo_file_id" BIGINT,
  ADD COLUMN "photo_meta" JSONB;

ALTER TABLE "style_bases"
  ADD CONSTRAINT "fk_style_bases__photo_file_id" FOREIGN KEY ("photo_file_id") REFERENCES "file_objects"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "ix_style_bases__photo_file_id" ON "style_bases"("photo_file_id");
