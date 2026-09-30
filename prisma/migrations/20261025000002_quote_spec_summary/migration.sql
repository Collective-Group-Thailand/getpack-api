-- U1 U-B0.1 slice 3 (schema-design A-51): the spec lines of a quote, resolved from catalogue names when it is made.
-- Null for quotes made before this migration (development data only, D-005).

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "spec_summary" JSONB;

