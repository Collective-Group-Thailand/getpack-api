-- CreateEnum
CREATE TYPE "artwork_source" AS ENUM ('upload', 'designer', 'design_service');

-- CreateEnum
CREATE TYPE "artwork_file_role" AS ENUM ('artwork', 'font', 'link', 'reference');

-- CreateEnum
CREATE TYPE "preflight_status" AS ENUM ('pending', 'running', 'passed', 'passed_with_warnings', 'blocked', 'error');

-- CreateEnum
CREATE TYPE "submission_status" AS ENUM ('submitted', 'superseded', 'accepted_for_proof', 'rejected');

-- CreateEnum
CREATE TYPE "preflight_check" AS ENUM ('size_mismatch', 'missing_bleed', 'low_resolution', 'rgb_colour', 'fonts_not_embedded', 'safe_zone', 'thin_lines', 'overprint', 'ink_coverage');

-- CreateEnum
CREATE TYPE "preflight_severity" AS ENUM ('block', 'warn', 'info');

-- CreateEnum
CREATE TYPE "proof_status" AS ENUM ('pending_customer', 'approved', 'changes_requested', 'superseded');

-- CreateEnum
CREATE TYPE "decision_channel" AS ENUM ('web', 'line_liff', 'cs_on_behalf');

-- CreateEnum
CREATE TYPE "annotation_kind" AS ENUM ('pin', 'rect', 'draw');

-- CreateEnum
CREATE TYPE "dieline_trigger" AS ENUM ('auto_after_payment', 'manual');

-- CreateEnum
CREATE TYPE "design_service_status" AS ENUM ('brief_pending', 'in_progress', 'delivered', 'revision_requested', 'approved', 'cancelled', 'requoted');

-- CreateEnum
CREATE TYPE "design_round_kind" AS ENUM ('initial', 'revision');

-- CreateEnum
CREATE TYPE "design_round_status" AS ENUM ('awaiting_payment', 'in_progress', 'delivered', 'approved', 'changes_requested');

-- CreateEnum
CREATE TYPE "design_asset_kind" AS ENUM ('image', 'font', 'logo', 'svg');

-- CreateEnum
CREATE TYPE "drawing_format" AS ENUM ('svg', 'dxf', 'pdf');

-- CreateEnum
CREATE TYPE "drawing_status" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'engine_unavailable');

-- AlterEnum
ALTER TYPE "attachment_subject" ADD VALUE 'design_service_request';

-- AlterTable
ALTER TABLE "cart_items" ADD COLUMN     "design_document_id" BIGINT,
ADD COLUMN     "reuse_artwork_proof_id" BIGINT;

-- AlterTable
ALTER TABLE "instalments" ADD COLUMN     "fixed_amount" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "design_document_id" BIGINT,
ADD COLUMN     "reuse_artwork_proof_id" BIGINT;

-- CreateTable
CREATE TABLE "artwork_submissions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" BIGINT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "source" "artwork_source" NOT NULL,
    "channel" "upload_channel" NOT NULL,
    "design_document_version_id" BIGINT,
    "note" TEXT,
    "submitted_by" BIGINT NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "preflight_status" "preflight_status" NOT NULL DEFAULT 'pending',
    "preflight_report" JSONB,
    "preflight_refs" JSONB,
    "preflight_completed_at" TIMESTAMPTZ(6),
    "preflight_locked_until" TIMESTAMPTZ(6),
    "preflight_attempts" SMALLINT NOT NULL DEFAULT 0,
    "status" "submission_status" NOT NULL DEFAULT 'submitted',
    "reviewed_by" BIGINT,
    "reviewed_at" TIMESTAMPTZ(6),
    "reject_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_artwork_submissions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artwork_submission_files" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "submission_id" BIGINT NOT NULL,
    "file_object_id" BIGINT,
    "link_url" TEXT,
    "role" "artwork_file_role" NOT NULL,
    "sort" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_artwork_submission_files" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preflight_findings" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "submission_id" BIGINT NOT NULL,
    "file_id" BIGINT,
    "run" SMALLINT NOT NULL DEFAULT 1,
    "check_key" "preflight_check" NOT NULL,
    "severity" "preflight_severity" NOT NULL,
    "page" SMALLINT,
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_preflight_findings" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proofs" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" BIGINT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "submission_id" BIGINT,
    "previous_proof_id" BIGINT,
    "change_note" TEXT,
    "proof_file_id" BIGINT NOT NULL,
    "dieline_file_id" BIGINT,
    "prepared_by" BIGINT NOT NULL,
    "status" "proof_status" NOT NULL DEFAULT 'pending_customer',
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by_user_id" BIGINT,
    "decision_channel" "decision_channel",
    "on_behalf_reason" TEXT,
    "decision_comment" TEXT,
    "decision_ip" INET,
    "decision_user_agent" TEXT,
    "approved_file_id" BIGINT,
    "approved_file_sha256" BYTEA,
    "reused_from_proof_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_proofs" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proof_annotations" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "proof_id" BIGINT NOT NULL,
    "parent_id" BIGINT,
    "page" SMALLINT NOT NULL,
    "kind" "annotation_kind" NOT NULL,
    "geometry" JSONB NOT NULL,
    "comment" TEXT NOT NULL,
    "author_user_id" BIGINT NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_proof_annotations" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dieline_deliveries" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" BIGINT NOT NULL,
    "drawing_job_id" BIGINT,
    "file_object_id" BIGINT,
    "trigger" "dieline_trigger" NOT NULL,
    "note" TEXT,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_by" BIGINT,

    CONSTRAINT "pk_dieline_deliveries" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_service_requests" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" BIGINT NOT NULL,
    "brief" JSONB,
    "brief_submitted_at" TIMESTAMPTZ(6),
    "assigned_user_id" BIGINT,
    "assigned_vendor_id" BIGINT,
    "status" "design_service_status" NOT NULL DEFAULT 'brief_pending',
    "target_due_at" TIMESTAMPTZ(6),
    "max_due_at" TIMESTAMPTZ(6),
    "free_rounds" SMALLINT NOT NULL,
    "design_fee_net" DECIMAL(14,2) NOT NULL,
    "policy_refs" JSONB NOT NULL,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_design_service_requests" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_rounds" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "request_id" BIGINT NOT NULL,
    "round_no" SMALLINT NOT NULL,
    "kind" "design_round_kind" NOT NULL,
    "chargeable" BOOLEAN NOT NULL DEFAULT false,
    "fee_amount" DECIMAL(14,2),
    "order_line_id" BIGINT,
    "instalment_id" BIGINT,
    "status" "design_round_status" NOT NULL,
    "change_request" TEXT,
    "submission_id" BIGINT,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_design_rounds" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_documents" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_user_id" BIGINT NOT NULL,
    "company_id" BIGINT,
    "catalog_product_id" BIGINT NOT NULL,
    "pattern_id" BIGINT,
    "length_mm" DECIMAL(10,2),
    "width_mm" DECIMAL(10,2),
    "height_mm" DECIMAL(10,2),
    "material_id" BIGINT,
    "semi_design_template_id" BIGINT,
    "title" TEXT NOT NULL,
    "thumbnail_file_id" BIGINT,
    "current_version_id" BIGINT,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_design_documents" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_document_versions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "document_id" BIGINT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "schema_version" SMALLINT NOT NULL,
    "document" JSONB NOT NULL,
    "content_sha256" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,

    CONSTRAINT "pk_design_document_versions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_assets" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "document_id" BIGINT NOT NULL,
    "file_object_id" BIGINT NOT NULL,
    "kind" "design_asset_kind" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_design_assets" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drawing_jobs" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "requested_by" BIGINT,
    "order_id" BIGINT,
    "design_document_id" BIGINT,
    "pattern_id" BIGINT NOT NULL,
    "length_mm" DECIMAL(10,2) NOT NULL,
    "width_mm" DECIMAL(10,2) NOT NULL,
    "height_mm" DECIMAL(10,2) NOT NULL,
    "format" "drawing_format" NOT NULL,
    "engine_version" TEXT,
    "status" "drawing_status" NOT NULL DEFAULT 'queued',
    "output_file_id" BIGINT,
    "error" TEXT,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_drawing_jobs" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_artwork_submissions__public_id" ON "artwork_submissions"("public_id");

-- CreateIndex
CREATE INDEX "ix_artwork_submissions__design_document_version_id" ON "artwork_submissions"("design_document_version_id");

-- CreateIndex
CREATE INDEX "ix_artwork_submissions__submitted_by" ON "artwork_submissions"("submitted_by");

-- CreateIndex
CREATE INDEX "ix_artwork_submissions__reviewed_by" ON "artwork_submissions"("reviewed_by");

-- CreateIndex
CREATE INDEX "ix_artwork_submissions__preflight_queue" ON "artwork_submissions"("preflight_status", "preflight_locked_until") WHERE (preflight_status = ANY (ARRAY['pending'::preflight_status, 'running'::preflight_status]));

-- CreateIndex
CREATE UNIQUE INDEX "ux_artwork_submissions__order_id__version_no" ON "artwork_submissions"("order_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_artwork_submission_files__public_id" ON "artwork_submission_files"("public_id");

-- CreateIndex
CREATE INDEX "ix_artwork_submission_files__submission_id" ON "artwork_submission_files"("submission_id");

-- CreateIndex
CREATE INDEX "ix_artwork_submission_files__file_object_id" ON "artwork_submission_files"("file_object_id");

-- CreateIndex
CREATE INDEX "ix_preflight_findings__submission_id__run" ON "preflight_findings"("submission_id", "run");

-- CreateIndex
CREATE INDEX "ix_preflight_findings__file_id" ON "preflight_findings"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_proofs__public_id" ON "proofs"("public_id");

-- CreateIndex
CREATE INDEX "ix_proofs__submission_id" ON "proofs"("submission_id");

-- CreateIndex
CREATE INDEX "ix_proofs__previous_proof_id" ON "proofs"("previous_proof_id");

-- CreateIndex
CREATE INDEX "ix_proofs__proof_file_id" ON "proofs"("proof_file_id");

-- CreateIndex
CREATE INDEX "ix_proofs__dieline_file_id" ON "proofs"("dieline_file_id");

-- CreateIndex
CREATE INDEX "ix_proofs__approved_file_id" ON "proofs"("approved_file_id");

-- CreateIndex
CREATE INDEX "ix_proofs__prepared_by" ON "proofs"("prepared_by");

-- CreateIndex
CREATE INDEX "ix_proofs__decided_by_user_id" ON "proofs"("decided_by_user_id");

-- CreateIndex
CREATE INDEX "ix_proofs__reused_from_proof_id" ON "proofs"("reused_from_proof_id");

-- CreateIndex
CREATE INDEX "ix_proofs__status__sent_at" ON "proofs"("status", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "ux_proofs__order_id__version_no" ON "proofs"("order_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_proofs__one_approved" ON "proofs"("order_id") WHERE (status = 'approved'::proof_status);

-- CreateIndex
CREATE UNIQUE INDEX "ux_proof_annotations__public_id" ON "proof_annotations"("public_id");

-- CreateIndex
CREATE INDEX "ix_proof_annotations__proof_id__created_at" ON "proof_annotations"("proof_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_proof_annotations__parent_id" ON "proof_annotations"("parent_id");

-- CreateIndex
CREATE INDEX "ix_proof_annotations__author_user_id" ON "proof_annotations"("author_user_id");

-- CreateIndex
CREATE INDEX "ix_proof_annotations__resolved_by" ON "proof_annotations"("resolved_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_dieline_deliveries__public_id" ON "dieline_deliveries"("public_id");

-- CreateIndex
CREATE INDEX "ix_dieline_deliveries__order_id" ON "dieline_deliveries"("order_id");

-- CreateIndex
CREATE INDEX "ix_dieline_deliveries__drawing_job_id" ON "dieline_deliveries"("drawing_job_id");

-- CreateIndex
CREATE INDEX "ix_dieline_deliveries__file_object_id" ON "dieline_deliveries"("file_object_id");

-- CreateIndex
CREATE INDEX "ix_dieline_deliveries__sent_by" ON "dieline_deliveries"("sent_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_dieline_deliveries__one_auto" ON "dieline_deliveries"("order_id") WHERE (trigger = 'auto_after_payment'::dieline_trigger);

-- CreateIndex
CREATE UNIQUE INDEX "ux_design_service_requests__public_id" ON "design_service_requests"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_design_service_requests__order_id" ON "design_service_requests"("order_id");

-- CreateIndex
CREATE INDEX "ix_design_service_requests__assigned_user_id" ON "design_service_requests"("assigned_user_id");

-- CreateIndex
CREATE INDEX "ix_design_service_requests__assigned_vendor_id" ON "design_service_requests"("assigned_vendor_id");

-- CreateIndex
CREATE INDEX "ix_design_service_requests__created_by" ON "design_service_requests"("created_by");

-- CreateIndex
CREATE INDEX "ix_design_service_requests__updated_by" ON "design_service_requests"("updated_by");

-- CreateIndex
CREATE INDEX "ix_design_service_requests__status__target_due_at" ON "design_service_requests"("status", "target_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "ux_design_rounds__public_id" ON "design_rounds"("public_id");

-- CreateIndex
CREATE INDEX "ix_design_rounds__order_line_id" ON "design_rounds"("order_line_id");

-- CreateIndex
CREATE INDEX "ix_design_rounds__instalment_id" ON "design_rounds"("instalment_id");

-- CreateIndex
CREATE INDEX "ix_design_rounds__submission_id" ON "design_rounds"("submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_design_rounds__request_id__round_no" ON "design_rounds"("request_id", "round_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_design_documents__public_id" ON "design_documents"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_design_documents__current_version_id" ON "design_documents"("current_version_id");

-- CreateIndex
CREATE INDEX "ix_design_documents__owner_user_id__updated_at" ON "design_documents"("owner_user_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "ix_design_documents__company_id" ON "design_documents"("company_id");

-- CreateIndex
CREATE INDEX "ix_design_documents__catalog_product_id" ON "design_documents"("catalog_product_id");

-- CreateIndex
CREATE INDEX "ix_design_documents__pattern_id" ON "design_documents"("pattern_id");

-- CreateIndex
CREATE INDEX "ix_design_documents__material_id" ON "design_documents"("material_id");

-- CreateIndex
CREATE INDEX "ix_design_documents__semi_design_template_id" ON "design_documents"("semi_design_template_id");

-- CreateIndex
CREATE INDEX "ix_design_documents__thumbnail_file_id" ON "design_documents"("thumbnail_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_design_document_versions__public_id" ON "design_document_versions"("public_id");

-- CreateIndex
CREATE INDEX "ix_design_document_versions__created_by" ON "design_document_versions"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_design_document_versions__document_id__version_no" ON "design_document_versions"("document_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_design_assets__public_id" ON "design_assets"("public_id");

-- CreateIndex
CREATE INDEX "ix_design_assets__file_object_id" ON "design_assets"("file_object_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_design_assets__document_id__file_object_id" ON "design_assets"("document_id", "file_object_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_drawing_jobs__public_id" ON "drawing_jobs"("public_id");

-- CreateIndex
CREATE INDEX "ix_drawing_jobs__requested_by" ON "drawing_jobs"("requested_by");

-- CreateIndex
CREATE INDEX "ix_drawing_jobs__order_id" ON "drawing_jobs"("order_id");

-- CreateIndex
CREATE INDEX "ix_drawing_jobs__design_document_id" ON "drawing_jobs"("design_document_id");

-- CreateIndex
CREATE INDEX "ix_drawing_jobs__pattern_id" ON "drawing_jobs"("pattern_id");

-- CreateIndex
CREATE INDEX "ix_drawing_jobs__output_file_id" ON "drawing_jobs"("output_file_id");

-- CreateIndex
CREATE INDEX "ix_drawing_jobs__queue" ON "drawing_jobs"("status", "locked_until") WHERE (status = ANY (ARRAY['queued'::drawing_status, 'running'::drawing_status]));

-- CreateIndex
CREATE INDEX "ix_cart_items__design_document_id" ON "cart_items"("design_document_id");

-- CreateIndex
CREATE INDEX "ix_cart_items__reuse_artwork_proof_id" ON "cart_items"("reuse_artwork_proof_id");

-- CreateIndex
CREATE INDEX "ix_orders__design_document_id" ON "orders"("design_document_id");

-- CreateIndex
CREATE INDEX "ix_orders__reuse_artwork_proof_id" ON "orders"("reuse_artwork_proof_id");

-- AddForeignKey
ALTER TABLE "semi_design_templates" ADD CONSTRAINT "fk_semi_design_templates__design_document_version_id" FOREIGN KEY ("design_document_version_id") REFERENCES "design_document_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "fk_cart_items__design_document_id" FOREIGN KEY ("design_document_id") REFERENCES "design_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "fk_cart_items__reuse_artwork_proof_id" FOREIGN KEY ("reuse_artwork_proof_id") REFERENCES "proofs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "fk_orders__design_document_id" FOREIGN KEY ("design_document_id") REFERENCES "design_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "fk_orders__reuse_artwork_proof_id" FOREIGN KEY ("reuse_artwork_proof_id") REFERENCES "proofs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "artwork_submissions" ADD CONSTRAINT "fk_artwork_submissions__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "artwork_submissions" ADD CONSTRAINT "fk_artwork_submissions__design_document_version_id" FOREIGN KEY ("design_document_version_id") REFERENCES "design_document_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "artwork_submissions" ADD CONSTRAINT "fk_artwork_submissions__submitted_by" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "artwork_submissions" ADD CONSTRAINT "fk_artwork_submissions__reviewed_by" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "artwork_submission_files" ADD CONSTRAINT "fk_artwork_submission_files__submission_id" FOREIGN KEY ("submission_id") REFERENCES "artwork_submissions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "artwork_submission_files" ADD CONSTRAINT "fk_artwork_submission_files__file_object_id" FOREIGN KEY ("file_object_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "preflight_findings" ADD CONSTRAINT "fk_preflight_findings__submission_id" FOREIGN KEY ("submission_id") REFERENCES "artwork_submissions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "preflight_findings" ADD CONSTRAINT "fk_preflight_findings__file_id" FOREIGN KEY ("file_id") REFERENCES "artwork_submission_files"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "proofs" ADD CONSTRAINT "fk_proofs__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "proofs" ADD CONSTRAINT "fk_proofs__submission_id" FOREIGN KEY ("submission_id") REFERENCES "artwork_submissions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "proofs" ADD CONSTRAINT "fk_proofs__previous_proof_id" FOREIGN KEY ("previous_proof_id") REFERENCES "proofs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "proofs" ADD CONSTRAINT "fk_proofs__proof_file_id" FOREIGN KEY ("proof_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "proofs" ADD CONSTRAINT "fk_proofs__dieline_file_id" FOREIGN KEY ("dieline_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "proofs" ADD CONSTRAINT "fk_proofs__approved_file_id" FOREIGN KEY ("approved_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "proofs" ADD CONSTRAINT "fk_proofs__prepared_by" FOREIGN KEY ("prepared_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "proofs" ADD CONSTRAINT "fk_proofs__decided_by_user_id" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "proofs" ADD CONSTRAINT "fk_proofs__reused_from_proof_id" FOREIGN KEY ("reused_from_proof_id") REFERENCES "proofs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "proof_annotations" ADD CONSTRAINT "fk_proof_annotations__proof_id" FOREIGN KEY ("proof_id") REFERENCES "proofs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "proof_annotations" ADD CONSTRAINT "fk_proof_annotations__parent_id" FOREIGN KEY ("parent_id") REFERENCES "proof_annotations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "proof_annotations" ADD CONSTRAINT "fk_proof_annotations__author_user_id" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "proof_annotations" ADD CONSTRAINT "fk_proof_annotations__resolved_by" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dieline_deliveries" ADD CONSTRAINT "fk_dieline_deliveries__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dieline_deliveries" ADD CONSTRAINT "fk_dieline_deliveries__drawing_job_id" FOREIGN KEY ("drawing_job_id") REFERENCES "drawing_jobs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dieline_deliveries" ADD CONSTRAINT "fk_dieline_deliveries__file_object_id" FOREIGN KEY ("file_object_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dieline_deliveries" ADD CONSTRAINT "fk_dieline_deliveries__sent_by" FOREIGN KEY ("sent_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_service_requests" ADD CONSTRAINT "fk_design_service_requests__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_service_requests" ADD CONSTRAINT "fk_design_service_requests__assigned_user_id" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_service_requests" ADD CONSTRAINT "fk_design_service_requests__assigned_vendor_id" FOREIGN KEY ("assigned_vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_service_requests" ADD CONSTRAINT "fk_design_service_requests__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_service_requests" ADD CONSTRAINT "fk_design_service_requests__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_rounds" ADD CONSTRAINT "fk_design_rounds__request_id" FOREIGN KEY ("request_id") REFERENCES "design_service_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_rounds" ADD CONSTRAINT "fk_design_rounds__order_line_id" FOREIGN KEY ("order_line_id") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_rounds" ADD CONSTRAINT "fk_design_rounds__instalment_id" FOREIGN KEY ("instalment_id") REFERENCES "instalments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_rounds" ADD CONSTRAINT "fk_design_rounds__submission_id" FOREIGN KEY ("submission_id") REFERENCES "artwork_submissions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_documents" ADD CONSTRAINT "fk_design_documents__owner_user_id" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_documents" ADD CONSTRAINT "fk_design_documents__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_documents" ADD CONSTRAINT "fk_design_documents__catalog_product_id" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_documents" ADD CONSTRAINT "fk_design_documents__pattern_id" FOREIGN KEY ("pattern_id") REFERENCES "patterns"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_documents" ADD CONSTRAINT "fk_design_documents__material_id" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_documents" ADD CONSTRAINT "fk_design_documents__semi_design_template_id" FOREIGN KEY ("semi_design_template_id") REFERENCES "semi_design_templates"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_documents" ADD CONSTRAINT "fk_design_documents__thumbnail_file_id" FOREIGN KEY ("thumbnail_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_documents" ADD CONSTRAINT "fk_design_documents__current_version_id" FOREIGN KEY ("current_version_id") REFERENCES "design_document_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_document_versions" ADD CONSTRAINT "fk_design_document_versions__document_id" FOREIGN KEY ("document_id") REFERENCES "design_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_document_versions" ADD CONSTRAINT "fk_design_document_versions__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_assets" ADD CONSTRAINT "fk_design_assets__document_id" FOREIGN KEY ("document_id") REFERENCES "design_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_assets" ADD CONSTRAINT "fk_design_assets__file_object_id" FOREIGN KEY ("file_object_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "drawing_jobs" ADD CONSTRAINT "fk_drawing_jobs__requested_by" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "drawing_jobs" ADD CONSTRAINT "fk_drawing_jobs__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "drawing_jobs" ADD CONSTRAINT "fk_drawing_jobs__design_document_id" FOREIGN KEY ("design_document_id") REFERENCES "design_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "drawing_jobs" ADD CONSTRAINT "fk_drawing_jobs__pattern_id" FOREIGN KEY ("pattern_id") REFERENCES "patterns"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "drawing_jobs" ADD CONSTRAINT "fk_drawing_jobs__output_file_id" FOREIGN KEY ("output_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- =====================================================================================================
-- Hand-written: artwork, preflight, proofs, design services, designs and drawings (D-070…D-072,
-- D-153; schema-design §3.7, A-36)
-- =====================================================================================================
ALTER TABLE instalments
  ADD CONSTRAINT ck_instalments__fixed_amount CHECK (NOT fixed_amount OR pct = 0);

ALTER TABLE artwork_submissions
  ADD CONSTRAINT ck_artwork_submissions__version CHECK (version_no > 0),
  ADD CONSTRAINT ck_artwork_submissions__attempts CHECK (preflight_attempts >= 0),
  ADD CONSTRAINT ck_artwork_submissions__rejected CHECK (status <> 'rejected' OR (reject_reason IS NOT NULL AND btrim(reject_reason) <> '')),
  ADD CONSTRAINT ck_artwork_submissions__reviewed CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL)),
  ADD CONSTRAINT ck_artwork_submissions__preflight_done CHECK (
    preflight_status IN ('pending', 'running') OR preflight_completed_at IS NOT NULL);
CREATE TRIGGER tg_artwork_submissions__no_delete BEFORE DELETE ON artwork_submissions
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE artwork_submission_files
  ADD CONSTRAINT ck_artwork_submission_files__source CHECK (num_nonnulls(file_object_id, link_url) = 1),
  ADD CONSTRAINT ck_artwork_submission_files__link CHECK ((role = 'link') = (link_url IS NOT NULL)),
  ADD CONSTRAINT ck_artwork_submission_files__https CHECK (link_url IS NULL OR link_url ~ '^https://');
CREATE TRIGGER tg_artwork_submission_files__append_only BEFORE UPDATE OR DELETE ON artwork_submission_files
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_row_change();

ALTER TABLE preflight_findings
  ADD CONSTRAINT ck_preflight_findings__run CHECK (run > 0),
  ADD CONSTRAINT ck_preflight_findings__page CHECK (page IS NULL OR page > 0);
CREATE TRIGGER tg_preflight_findings__append_only BEFORE UPDATE OR DELETE ON preflight_findings
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_row_change();

-- A proof is decided once: approved (with the locked, hashed file and the decision evidence),
-- changes requested, or superseded by a newer version; afterwards the row never changes.
ALTER TABLE proofs
  ADD CONSTRAINT ck_proofs__version CHECK (version_no > 0),
  ADD CONSTRAINT ck_proofs__sha256 CHECK (approved_file_sha256 IS NULL OR octet_length(approved_file_sha256) = 32),
  ADD CONSTRAINT ck_proofs__decided CHECK (status = 'pending_customer' OR decided_at IS NOT NULL),
  ADD CONSTRAINT ck_proofs__approved CHECK (status <> 'approved' OR (
    decided_by_user_id IS NOT NULL AND decision_channel IS NOT NULL
    AND approved_file_id IS NOT NULL AND approved_file_sha256 IS NOT NULL)),
  ADD CONSTRAINT ck_proofs__on_behalf CHECK (decision_channel IS DISTINCT FROM 'cs_on_behalf'
    OR (on_behalf_reason IS NOT NULL AND btrim(on_behalf_reason) <> '')),
  ADD CONSTRAINT ck_proofs__not_self CHECK (previous_proof_id IS DISTINCT FROM id AND reused_from_proof_id IS DISTINCT FROM id);
CREATE FUNCTION tg_proofs__decided_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'proofs are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'pending_customer' THEN
    RAISE EXCEPTION 'proof % is % and cannot change', OLD.id, OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.order_id <> OLD.order_id OR NEW.version_no <> OLD.version_no OR NEW.proof_file_id <> OLD.proof_file_id
     OR NEW.dieline_file_id IS DISTINCT FROM OLD.dieline_file_id OR NEW.prepared_by <> OLD.prepared_by
     OR NEW.submission_id IS DISTINCT FROM OLD.submission_id OR NEW.sent_at <> OLD.sent_at THEN
    RAISE EXCEPTION 'proof % content is write-once', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_proofs__decided_frozen BEFORE UPDATE OR DELETE ON proofs
  FOR EACH ROW EXECUTE FUNCTION tg_proofs__decided_frozen();

ALTER TABLE proof_annotations
  ADD CONSTRAINT ck_proof_annotations__page CHECK (page > 0),
  ADD CONSTRAINT ck_proof_annotations__comment CHECK (btrim(comment) <> ''),
  ADD CONSTRAINT ck_proof_annotations__resolved CHECK ((resolved_at IS NULL) = (resolved_by IS NULL)),
  ADD CONSTRAINT ck_proof_annotations__not_self CHECK (parent_id IS DISTINCT FROM id);
CREATE TRIGGER tg_proof_annotations__no_delete BEFORE DELETE ON proof_annotations
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE dieline_deliveries
  ADD CONSTRAINT ck_dieline_deliveries__source CHECK (num_nonnulls(drawing_job_id, file_object_id) >= 1),
  ADD CONSTRAINT ck_dieline_deliveries__manual_by CHECK (trigger <> 'manual' OR sent_by IS NOT NULL);
CREATE TRIGGER tg_dieline_deliveries__append_only BEFORE UPDATE OR DELETE ON dieline_deliveries
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_row_change();

ALTER TABLE design_service_requests
  ADD CONSTRAINT ck_design_service_requests__rounds CHECK (free_rounds >= 0),
  ADD CONSTRAINT ck_design_service_requests__fee CHECK (design_fee_net >= 0),
  ADD CONSTRAINT ck_design_service_requests__due CHECK (target_due_at IS NULL OR max_due_at IS NULL OR max_due_at >= target_due_at),
  ADD CONSTRAINT ck_design_service_requests__cancelled CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL),
  ADD CONSTRAINT ck_design_service_requests__brief CHECK (status = 'brief_pending' OR status = 'cancelled' OR brief_submitted_at IS NOT NULL);
CREATE TRIGGER tg_design_service_requests__no_delete BEFORE DELETE ON design_service_requests
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE design_rounds
  ADD CONSTRAINT ck_design_rounds__no CHECK (round_no > 0),
  ADD CONSTRAINT ck_design_rounds__initial CHECK ((kind = 'initial') = (round_no = 1)),
  ADD CONSTRAINT ck_design_rounds__fee CHECK (NOT chargeable OR (fee_amount IS NOT NULL AND fee_amount > 0)),
  ADD CONSTRAINT ck_design_rounds__free CHECK (chargeable OR (fee_amount IS NULL AND order_line_id IS NULL AND instalment_id IS NULL)),
  ADD CONSTRAINT ck_design_rounds__awaiting CHECK (status <> 'awaiting_payment' OR chargeable),
  ADD CONSTRAINT ck_design_rounds__started CHECK (status = 'awaiting_payment' OR started_at IS NOT NULL);
CREATE TRIGGER tg_design_rounds__no_delete BEFORE DELETE ON design_rounds
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE design_documents
  ADD CONSTRAINT ck_design_documents__title CHECK (btrim(title) <> ''),
  ADD CONSTRAINT ck_design_documents__dims CHECK (
    (length_mm IS NULL OR length_mm > 0) AND (width_mm IS NULL OR width_mm > 0) AND (height_mm IS NULL OR height_mm > 0));

ALTER TABLE design_document_versions
  ADD CONSTRAINT ck_design_document_versions__no CHECK (version_no > 0),
  ADD CONSTRAINT ck_design_document_versions__schema CHECK (schema_version > 0),
  ADD CONSTRAINT ck_design_document_versions__sha256 CHECK (octet_length(content_sha256) = 32);
CREATE TRIGGER tg_design_document_versions__immutable BEFORE UPDATE OR DELETE ON design_document_versions
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_row_change();

ALTER TABLE drawing_jobs
  ADD CONSTRAINT ck_drawing_jobs__dims CHECK (length_mm > 0 AND width_mm > 0 AND height_mm >= 0),
  ADD CONSTRAINT ck_drawing_jobs__attempts CHECK (attempts >= 0),
  ADD CONSTRAINT ck_drawing_jobs__succeeded CHECK (status <> 'succeeded' OR (output_file_id IS NOT NULL AND completed_at IS NOT NULL)),
  ADD CONSTRAINT ck_drawing_jobs__failed CHECK (status NOT IN ('failed', 'engine_unavailable') OR error IS NOT NULL);
CREATE TRIGGER tg_drawing_jobs__no_delete BEFORE DELETE ON drawing_jobs
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();
