-- U2.1 (schema-design A-79, D-183): the unit the web shows sizes in, per user; the API stays millimetre-only.

-- CreateEnum
CREATE TYPE "display_unit" AS ENUM ('mm', 'cm', 'in');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "display_unit" "display_unit" NOT NULL DEFAULT 'mm';

