-- U2.1 (schema-design A-80, D-182): the measurement basis of a size and the board caliper the conversion between bases
-- reads. RFQs, design documents and drawing jobs written before carry internal sizes (the column default is the
-- backfill); write-once quote / order / job snapshots are not rewritten — a snapshot without a basis reads as internal.

-- CreateEnum
CREATE TYPE "measurement_basis" AS ENUM ('internal', 'external', 'over_crease', 'product');

-- AlterTable
ALTER TABLE "design_documents" ADD COLUMN     "measurement_basis" "measurement_basis" NOT NULL DEFAULT 'internal';

-- AlterTable
ALTER TABLE "drawing_jobs" ADD COLUMN     "measurement_basis" "measurement_basis" NOT NULL DEFAULT 'internal';

-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "caliper_mm" DECIMAL(6,3);

-- AlterTable
ALTER TABLE "rfqs" ADD COLUMN     "measurement_basis" "measurement_basis" NOT NULL DEFAULT 'internal';


-- Hand-written (A-80)
ALTER TABLE materials
  ADD CONSTRAINT ck_materials__caliper CHECK (caliper_mm IS NULL OR (caliper_mm > 0 AND caliper_mm <= 50));
