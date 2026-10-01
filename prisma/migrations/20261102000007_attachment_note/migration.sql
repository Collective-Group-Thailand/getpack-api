-- U1 U-B0.3 slice 12b (schema-design A-70): what the uploader says an attached file shows (price-proposal evidence).

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "note" TEXT;


-- Hand-written (A-70)
ALTER TABLE attachments
  ADD CONSTRAINT ck_attachments__note CHECK (note IS NULL OR (btrim(note) <> '' AND char_length(note) <= 500));
