-- U1 U-B0.1 slice 8 (schema-design A-55, D-222): PDPA data-subject requests (one open request per kind and customer),
-- and when a customer first saved their profile (the storefront stops prompting for it).

-- CreateEnum
CREATE TYPE "privacy_request_kind" AS ENUM ('export', 'deletion');

-- CreateEnum
CREATE TYPE "privacy_request_status" AS ENUM ('submitted', 'completed', 'rejected');

-- AlterTable
ALTER TABLE "customer_profiles" ADD COLUMN     "profile_completed_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "privacy_requests" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" BIGINT NOT NULL,
    "kind" "privacy_request_kind" NOT NULL,
    "status" "privacy_request_status" NOT NULL DEFAULT 'submitted',
    "note" TEXT,
    "answer" TEXT,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "export_file_id" BIGINT,
    "export_expires_at" TIMESTAMPTZ(6),
    "decided_by" BIGINT,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_privacy_requests" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_privacy_requests__public_id" ON "privacy_requests"("public_id");

-- CreateIndex
CREATE INDEX "ix_privacy_requests__user_id__created_at" ON "privacy_requests"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_privacy_requests__status__due_at" ON "privacy_requests"("status", "due_at");

-- CreateIndex
CREATE INDEX "ix_privacy_requests__export_file_id" ON "privacy_requests"("export_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_privacy_requests__one_open" ON "privacy_requests"("user_id", "kind") WHERE (status = 'submitted'::privacy_request_status);

-- AddForeignKey
ALTER TABLE "privacy_requests" ADD CONSTRAINT "fk_privacy_requests__user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "privacy_requests" ADD CONSTRAINT "fk_privacy_requests__export_file_id" FOREIGN KEY ("export_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "privacy_requests" ADD CONSTRAINT "fk_privacy_requests__decided_by" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

