-- U1 U-B0.1 slice 9b (schema-design A-57): design version kind / label / thumbnail, view-only share link (D-226),
-- import of browser-kept guest designs.

-- CreateEnum
CREATE TYPE "design_version_kind" AS ENUM ('manual', 'autosave', 'restore', 'import');

-- AlterTable
ALTER TABLE "design_document_versions" ADD COLUMN     "kind" "design_version_kind" NOT NULL DEFAULT 'manual',
ADD COLUMN     "label" TEXT,
ADD COLUMN     "thumbnail_file_id" BIGINT;

-- AlterTable
ALTER TABLE "design_documents" ADD COLUMN     "import_local_id" TEXT,
ADD COLUMN     "share_expires_at" TIMESTAMPTZ(6),
ADD COLUMN     "share_token_hash" BYTEA,
ADD COLUMN     "shared_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "ix_design_document_versions__thumbnail_file_id" ON "design_document_versions"("thumbnail_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_design_documents__share_token_hash" ON "design_documents"("share_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "ux_design_documents__owner__import_local_id" ON "design_documents"("owner_user_id", "import_local_id") WHERE (import_local_id IS NOT NULL);

-- AddForeignKey
ALTER TABLE "design_document_versions" ADD CONSTRAINT "fk_design_document_versions__thumbnail_file_id" FOREIGN KEY ("thumbnail_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written checks.
ALTER TABLE "design_documents" ADD CONSTRAINT "ck_design_documents__share"
  CHECK ((share_token_hash IS NULL AND shared_at IS NULL AND share_expires_at IS NULL)
      OR (share_token_hash IS NOT NULL AND shared_at IS NOT NULL AND share_expires_at > shared_at));
ALTER TABLE "design_documents" ADD CONSTRAINT "ck_design_documents__import_local_id"
  CHECK (import_local_id IS NULL OR char_length(import_local_id) BETWEEN 1 AND 100);
ALTER TABLE "design_document_versions" ADD CONSTRAINT "ck_design_document_versions__label"
  CHECK (label IS NULL OR char_length(label) BETWEEN 1 AND 100);
