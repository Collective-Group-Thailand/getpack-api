-- Reverts 20261215000001_files_metadata_production_copies (Prisma does not run this file; apply it by hand with
-- psql, then delete the migration's row from `_prisma_migrations` and redeploy the previous release).
--
-- The production copies' file objects stay (they are ordinary private files nobody references any more; the
-- retention phase decides about them). Scrubbed uploads stay scrubbed: the removed metadata is not kept anywhere.
DROP TABLE IF EXISTS "artwork_production_copies";
DROP TYPE IF EXISTS "production_copy_failure";
DROP TYPE IF EXISTS "production_copy_status";
ALTER TABLE "file_objects" DROP COLUMN IF EXISTS "metadata_stripped_at",
DROP COLUMN IF EXISTS "purpose";
