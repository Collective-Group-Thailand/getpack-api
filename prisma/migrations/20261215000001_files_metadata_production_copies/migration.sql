-- Confidentiality leftovers (getpack redesign, step A5b) — reversible: `down.sql` in this folder undoes it.
--
-- D-442 (GLOBAL-RULES §1, DECISIONS-STAGE-A §1 "Production access to originals"):
--   1. `file_objects.purpose` records what an upload was for (`FILE_PURPOSES`), so the worker knows which files are
--      shared with customers or production and must lose their metadata; `metadata_stripped_at` records when the
--      stored bytes were scrubbed (EXIF / GPS, XMP, PDF Info). Existing rows keep NULL (nothing is rewritten).
--   2. `artwork_production_copies`: the copy of a customer's original artwork file that production may download —
--      metadata stripped, named by the order code, no customer identity. One per submission file.

-- CreateEnum
CREATE TYPE "production_copy_status" AS ENUM ('pending', 'ready', 'unsupported');

-- CreateEnum
CREATE TYPE "production_copy_failure" AS ENUM ('unsupported_format', 'encrypted', 'signed', 'unreadable', 'too_large', 'source_unavailable');

-- AlterTable
ALTER TABLE "file_objects" ADD COLUMN "metadata_stripped_at" TIMESTAMPTZ(6),
ADD COLUMN "purpose" VARCHAR(32);

-- CreateTable
CREATE TABLE "artwork_production_copies" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "submission_file_id" BIGINT NOT NULL,
    "source_file_id" BIGINT NOT NULL,
    "copy_file_id" BIGINT,
    "status" "production_copy_status" NOT NULL DEFAULT 'pending',
    "failure_reason" "production_copy_failure",
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "ready_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_artwork_production_copies" PRIMARY KEY ("id"),
    -- A ready copy names its file and when it was made; an unsupported one says why; a pending one neither.
    CONSTRAINT "ck_artwork_production_copies__state" CHECK (
      (status = 'ready' AND copy_file_id IS NOT NULL AND ready_at IS NOT NULL AND failure_reason IS NULL)
      OR (status = 'unsupported' AND copy_file_id IS NULL AND failure_reason IS NOT NULL)
      OR (status = 'pending' AND copy_file_id IS NULL AND failure_reason IS NULL)
    ),
    CONSTRAINT "ck_artwork_production_copies__attempts" CHECK (attempts >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_artwork_production_copies__public_id" ON "artwork_production_copies"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_artwork_production_copies__submission_file_id" ON "artwork_production_copies"("submission_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_artwork_production_copies__copy_file_id" ON "artwork_production_copies"("copy_file_id");

-- CreateIndex
CREATE INDEX "ix_artwork_production_copies__source_file_id" ON "artwork_production_copies"("source_file_id");

-- CreateIndex
CREATE INDEX "ix_artwork_production_copies__status" ON "artwork_production_copies"("status", "locked_until");

-- AddForeignKey
ALTER TABLE "artwork_production_copies" ADD CONSTRAINT "fk_artwork_production_copies__submission_file_id" FOREIGN KEY ("submission_file_id") REFERENCES "artwork_submission_files"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "artwork_production_copies" ADD CONSTRAINT "fk_artwork_production_copies__source_file_id" FOREIGN KEY ("source_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "artwork_production_copies" ADD CONSTRAINT "fk_artwork_production_copies__copy_file_id" FOREIGN KEY ("copy_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
