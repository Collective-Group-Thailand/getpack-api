-- U2.9 (schema-design A-108; D-296, D-210): feature flags carry dev_only (never on in production).
-- AlterTable
ALTER TABLE "feature_flags" ADD COLUMN     "dev_only" BOOLEAN NOT NULL DEFAULT false;

