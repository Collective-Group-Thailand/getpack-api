-- D-384: more units for items and document lines — pouch and tube for packaging, job, round and trip for services.

-- AlterEnum
ALTER TYPE "erp_unit" ADD VALUE 'pouch';
ALTER TYPE "erp_unit" ADD VALUE 'tube';
ALTER TYPE "erp_unit" ADD VALUE 'job';
ALTER TYPE "erp_unit" ADD VALUE 'round';
ALTER TYPE "erp_unit" ADD VALUE 'trip';
