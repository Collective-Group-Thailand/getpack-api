-- U1 U-B0.1 slice 5b (schema-design A-53): what a customer may be told about a failed payment; failure_reason stays internal.
-- Existing failed payments keep a null code (development data only, D-005).

-- CreateEnum
CREATE TYPE "payment_failure_code" AS ENUM ('provider_error', 'declined');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "failure_code" "payment_failure_code";

