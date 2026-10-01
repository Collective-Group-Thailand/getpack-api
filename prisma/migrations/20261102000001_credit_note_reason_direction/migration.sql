-- U1 U-B0.3 slice 1 (schema-design A-64): a credit-note reason says whether it lowers (credit note) or raises
-- (debit note) what the customer owes; the two seeded debit-note reasons are set here for existing databases.

-- CreateEnum
CREATE TYPE "cn_direction" AS ENUM ('credit', 'debit');

-- AlterTable
ALTER TABLE "credit_note_reasons" ADD COLUMN     "direction" "cn_direction" NOT NULL DEFAULT 'credit';

-- Hand-written (A-64): the seeded debit-note reasons.
UPDATE "credit_note_reasons" SET "direction" = 'debit' WHERE "code" IN ('additional_charge', 'price_increase');
