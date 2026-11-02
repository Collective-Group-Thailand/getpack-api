-- D-466 (agent portal pack, Phase 1): two-step onboarding. Step 1 (apply) needs contact and how the applicant sells;
-- tax, address, identity document and bank move to the payout profile, required before the first payout. Columns of
-- earlier applications become nullable (non-destructive: old rows keep their values). Rollback: down.sql.
-- CreateEnum
CREATE TYPE "sales_agent_sales_channel" AS ENUM ('line_groups', 'facebook', 'own_network', 'agency', 'print_shop', 'design_studio', 'other');

-- CreateEnum
CREATE TYPE "sales_agent_payout_profile_status" AS ENUM ('draft', 'submitted', 'verified', 'rejected');

-- AlterTable
ALTER TABLE "sales_agent_applications" ADD COLUMN     "email" CITEXT,
ADD COLUMN     "line_id" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "sales_channels" "sales_agent_sales_channel"[] DEFAULT ARRAY[]::"sales_agent_sales_channel"[],
ALTER COLUMN "tax_id" DROP NOT NULL,
ALTER COLUMN "address" DROP NOT NULL,
ALTER COLUMN "postcode" DROP NOT NULL,
ALTER COLUMN "id_document_file_id" DROP NOT NULL,
ALTER COLUMN "bank_code" DROP NOT NULL,
ALTER COLUMN "bank_account_name" DROP NOT NULL,
ALTER COLUMN "bank_account_no_enc" DROP NOT NULL,
ALTER COLUMN "bank_account_no_last4" DROP NOT NULL;

-- AlterTable
ALTER TABLE "sales_agent_statements" ADD COLUMN     "flags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "sales_agent_payout_profiles" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "agent_id" BIGINT NOT NULL,
    "legal_name" TEXT,
    "tax_id" CHAR(13),
    "branch_code" CHAR(5) NOT NULL DEFAULT '00000',
    "is_vat_registered" BOOLEAN NOT NULL DEFAULT false,
    "address" TEXT,
    "postcode" CHAR(5),
    "id_document_file_id" BIGINT,
    "bank_code" TEXT,
    "bank_branch_name" TEXT,
    "bank_account_name" TEXT,
    "bank_account_no_enc" BYTEA,
    "bank_account_no_last4" CHAR(4),
    "bank_book_file_id" BIGINT,
    "status" "sales_agent_payout_profile_status" NOT NULL DEFAULT 'draft',
    "submitted_at" TIMESTAMPTZ(6),
    "verified_at" TIMESTAMPTZ(6),
    "verified_by" BIGINT,
    "reject_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_sales_agent_payout_profiles" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_payout_profiles__public_id" ON "sales_agent_payout_profiles"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_payout_profiles__agent_id" ON "sales_agent_payout_profiles"("agent_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_payout_profiles__status__submitted_at" ON "sales_agent_payout_profiles"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "ix_sales_agent_payout_profiles__id_document_file_id" ON "sales_agent_payout_profiles"("id_document_file_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_payout_profiles__bank_book_file_id" ON "sales_agent_payout_profiles"("bank_book_file_id");

-- CreateIndex
CREATE INDEX "ix_sales_agent_payout_profiles__verified_by" ON "sales_agent_payout_profiles"("verified_by");

-- AddForeignKey
ALTER TABLE "sales_agent_payout_profiles" ADD CONSTRAINT "fk_sales_agent_payout_profiles__agent_id" FOREIGN KEY ("agent_id") REFERENCES "sales_agents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_payout_profiles" ADD CONSTRAINT "fk_sales_agent_payout_profiles__id_document_file_id" FOREIGN KEY ("id_document_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_payout_profiles" ADD CONSTRAINT "fk_sales_agent_payout_profiles__bank_book_file_id" FOREIGN KEY ("bank_book_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales_agent_payout_profiles" ADD CONSTRAINT "fk_sales_agent_payout_profiles__verified_by" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

