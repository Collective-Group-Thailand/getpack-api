-- D-428 – D-433: document branding (logo, seal, signatories), e-Tax Invoice by Email, cancel-and-replace of tax
-- invoices with customer correction requests, every tax invoice full form, factory tax invoices from the ERP.

-- CreateEnum
CREATE TYPE "document_owner_kind" AS ENUM ('entity', 'factory');
CREATE TYPE "document_brand_mark_kind" AS ENUM ('logo', 'seal');
CREATE TYPE "document_signing_kind" AS ENUM ('tax_invoice', 'receipt', 'invoice', 'credit_note', 'debit_note', 'quotation', 'sales_order', 'delivery_note', 'billing_note', 'wht_certificate', 'statement');
CREATE TYPE "etax_submission_kind" AS ENUM ('inv', 'dbn', 'crn', 'civ');
CREATE TYPE "etax_submission_status" AS ENUM ('queued', 'sent', 'failed');
CREATE TYPE "document_correction_reason" AS ENUM ('buyer_name', 'buyer_address', 'buyer_tax_id', 'other');
CREATE TYPE "document_correction_status" AS ENUM ('pending', 'approved', 'rejected', 'withdrawn');

-- AlterEnum
ALTER TYPE "etax_status" ADD VALUE 'failed';
ALTER TYPE "vendor_invoice_source" ADD VALUE 'erp';

-- CreateTable
CREATE TABLE "document_brand_marks" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_kind" "document_owner_kind" NOT NULL,
    "entity_id" BIGINT,
    "factory_id" BIGINT,
    "kind" "document_brand_mark_kind" NOT NULL,
    "file_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,

    CONSTRAINT "pk_document_brand_marks" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_signatories" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_kind" "document_owner_kind" NOT NULL,
    "entity_id" BIGINT,
    "factory_id" BIGINT,
    "user_id" BIGINT NOT NULL,
    "removed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,

    CONSTRAINT "pk_document_signatories" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_signatures" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "signatory_id" BIGINT NOT NULL,
    "file_id" BIGINT,
    "display_name" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,

    CONSTRAINT "pk_document_signatures" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_signing_rules" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "owner_kind" "document_owner_kind" NOT NULL,
    "entity_id" BIGINT,
    "factory_id" BIGINT,
    "doc_kind" "document_signing_kind" NOT NULL,
    "signatory_id" BIGINT,
    "stamp_seal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT NOT NULL,

    CONSTRAINT "pk_document_signing_rules" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "etax_submissions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "customer_document_id" BIGINT NOT NULL,
    "kind" "etax_submission_kind" NOT NULL,
    "status" "etax_submission_status" NOT NULL DEFAULT 'queued',
    "subject" TEXT NOT NULL,
    "to_address" TEXT,
    "cc_address" TEXT NOT NULL,
    "from_address" TEXT,
    "file_id" BIGINT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "provider_message_id" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_etax_submissions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_correction_requests" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "customer_document_id" BIGINT NOT NULL,
    "requested_by" BIGINT NOT NULL,
    "reason" "document_correction_reason" NOT NULL,
    "note" TEXT,
    "buyer" JSONB NOT NULL,
    "status" "document_correction_status" NOT NULL DEFAULT 'pending',
    "decided_by" BIGINT,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "replacement_document_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_document_correction_requests" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_document_brand_marks__public_id" ON "document_brand_marks"("public_id");

-- CreateIndex
CREATE INDEX "ix_document_brand_marks__entity_id__kind__created_at" ON "document_brand_marks"("entity_id", "kind", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_document_brand_marks__factory_id__kind__created_at" ON "document_brand_marks"("factory_id", "kind", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_document_brand_marks__file_id" ON "document_brand_marks"("file_id");

-- CreateIndex
CREATE INDEX "ix_document_brand_marks__created_by" ON "document_brand_marks"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_document_signatories__public_id" ON "document_signatories"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_document_signatories__entity_id__user_id" ON "document_signatories"("entity_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_document_signatories__factory_id__user_id" ON "document_signatories"("factory_id", "user_id");

-- CreateIndex
CREATE INDEX "ix_document_signatories__user_id" ON "document_signatories"("user_id");

-- CreateIndex
CREATE INDEX "ix_document_signatories__created_by" ON "document_signatories"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_document_signatures__public_id" ON "document_signatures"("public_id");

-- CreateIndex
CREATE INDEX "ix_document_signatures__signatory_id__created_at" ON "document_signatures"("signatory_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_document_signatures__file_id" ON "document_signatures"("file_id");

-- CreateIndex
CREATE INDEX "ix_document_signatures__created_by" ON "document_signatures"("created_by");

-- CreateIndex
CREATE INDEX "ix_document_signing_rules__entity_id__doc_kind__created_at" ON "document_signing_rules"("entity_id", "doc_kind", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_document_signing_rules__factory_id__doc_kind__created_at" ON "document_signing_rules"("factory_id", "doc_kind", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_document_signing_rules__signatory_id" ON "document_signing_rules"("signatory_id");

-- CreateIndex
CREATE INDEX "ix_document_signing_rules__created_by" ON "document_signing_rules"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_etax_submissions__public_id" ON "etax_submissions"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_etax_submissions__customer_document_id__kind" ON "etax_submissions"("customer_document_id", "kind");

-- CreateIndex
CREATE INDEX "ix_etax_submissions__status__next_attempt_at" ON "etax_submissions"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "ix_etax_submissions__entity_id" ON "etax_submissions"("entity_id");

-- CreateIndex
CREATE INDEX "ix_etax_submissions__file_id" ON "etax_submissions"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_document_correction_requests__public_id" ON "document_correction_requests"("public_id");

-- CreateIndex
CREATE INDEX "ix_document_correction_requests__status__created_at" ON "document_correction_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "ix_document_correction_requests__customer_document_id" ON "document_correction_requests"("customer_document_id");

-- CreateIndex
CREATE INDEX "ix_document_correction_requests__replacement_document_id" ON "document_correction_requests"("replacement_document_id");

-- CreateIndex
CREATE INDEX "ix_document_correction_requests__requested_by" ON "document_correction_requests"("requested_by");

-- CreateIndex
CREATE INDEX "ix_document_correction_requests__decided_by" ON "document_correction_requests"("decided_by");

-- CreateIndex
CREATE INDEX "ix_document_correction_requests__entity_id" ON "document_correction_requests"("entity_id");

-- AddForeignKey
ALTER TABLE "document_brand_marks" ADD CONSTRAINT "fk_document_brand_marks__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_brand_marks" ADD CONSTRAINT "fk_document_brand_marks__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_brand_marks" ADD CONSTRAINT "fk_document_brand_marks__file_id" FOREIGN KEY ("file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_brand_marks" ADD CONSTRAINT "fk_document_brand_marks__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_signatories" ADD CONSTRAINT "fk_document_signatories__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_signatories" ADD CONSTRAINT "fk_document_signatories__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_signatories" ADD CONSTRAINT "fk_document_signatories__user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_signatories" ADD CONSTRAINT "fk_document_signatories__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_signatures" ADD CONSTRAINT "fk_document_signatures__signatory_id" FOREIGN KEY ("signatory_id") REFERENCES "document_signatories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_signatures" ADD CONSTRAINT "fk_document_signatures__file_id" FOREIGN KEY ("file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_signatures" ADD CONSTRAINT "fk_document_signatures__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_signing_rules" ADD CONSTRAINT "fk_document_signing_rules__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_signing_rules" ADD CONSTRAINT "fk_document_signing_rules__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_signing_rules" ADD CONSTRAINT "fk_document_signing_rules__signatory_id" FOREIGN KEY ("signatory_id") REFERENCES "document_signatories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_signing_rules" ADD CONSTRAINT "fk_document_signing_rules__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "etax_submissions" ADD CONSTRAINT "fk_etax_submissions__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "etax_submissions" ADD CONSTRAINT "fk_etax_submissions__customer_document_id" FOREIGN KEY ("customer_document_id") REFERENCES "customer_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "etax_submissions" ADD CONSTRAINT "fk_etax_submissions__file_id" FOREIGN KEY ("file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_correction_requests" ADD CONSTRAINT "fk_document_correction_requests__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_correction_requests" ADD CONSTRAINT "fk_document_correction_requests__customer_document_id" FOREIGN KEY ("customer_document_id") REFERENCES "customer_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_correction_requests" ADD CONSTRAINT "fk_document_correction_requests__replacement_document_id" FOREIGN KEY ("replacement_document_id") REFERENCES "customer_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_correction_requests" ADD CONSTRAINT "fk_document_correction_requests__requested_by" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "document_correction_requests" ADD CONSTRAINT "fk_document_correction_requests__decided_by" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- An owner is getpack's entity or one factory, never both.
ALTER TABLE "document_brand_marks" ADD CONSTRAINT "ck_document_brand_marks__owner" CHECK (("owner_kind" = 'entity' AND "entity_id" IS NOT NULL AND "factory_id" IS NULL) OR ("owner_kind" = 'factory' AND "factory_id" IS NOT NULL AND "entity_id" IS NULL));
ALTER TABLE "document_signatories" ADD CONSTRAINT "ck_document_signatories__owner" CHECK (("owner_kind" = 'entity' AND "entity_id" IS NOT NULL AND "factory_id" IS NULL) OR ("owner_kind" = 'factory' AND "factory_id" IS NOT NULL AND "entity_id" IS NULL));
ALTER TABLE "document_signing_rules" ADD CONSTRAINT "ck_document_signing_rules__owner" CHECK (("owner_kind" = 'entity' AND "entity_id" IS NOT NULL AND "factory_id" IS NULL) OR ("owner_kind" = 'factory' AND "factory_id" IS NOT NULL AND "entity_id" IS NULL));

-- Marks, signatures and signing rules are a history: a document renders with the rows in force at its issue.
CREATE TRIGGER tg_document_brand_marks__append_only BEFORE UPDATE OR DELETE ON document_brand_marks
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER tg_document_signatures__append_only BEFORE UPDATE OR DELETE ON document_signatures
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER tg_document_signing_rules__append_only BEFORE UPDATE OR DELETE ON document_signing_rules
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- AlterTable: customer documents (D-431, D-432)
ALTER TABLE "customer_documents" ALTER COLUMN "is_full_form" SET DEFAULT true;
ALTER TABLE "customer_documents" ADD COLUMN "replaces_document_id" BIGINT,
  ADD COLUMN "replacement_reason" "document_correction_reason",
  ADD COLUMN "replacement_note" TEXT,
  ADD COLUMN "cancelled_pdf_file_id" BIGINT;
CREATE UNIQUE INDEX "ux_customer_documents__replaces_document_id" ON "customer_documents"("replaces_document_id");
CREATE INDEX "ix_customer_documents__cancelled_pdf_file_id" ON "customer_documents"("cancelled_pdf_file_id");
ALTER TABLE "customer_documents" ADD CONSTRAINT "fk_customer_documents__replaces_document_id" FOREIGN KEY ("replaces_document_id") REFERENCES "customer_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "customer_documents" ADD CONSTRAINT "fk_customer_documents__cancelled_pdf_file_id" FOREIGN KEY ("cancelled_pdf_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AlterTable: factory tax invoices from the ERP (D-433)
ALTER TABLE "vendor_invoices" ADD COLUMN "erp_sales_invoice_id" BIGINT;
CREATE UNIQUE INDEX "ux_vendor_invoices__erp_sales_invoice_id" ON "vendor_invoices"("erp_sales_invoice_id");
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "fk_vendor_invoices__erp_sales_invoice_id" FOREIGN KEY ("erp_sales_invoice_id") REFERENCES "erp_sales_invoices"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- A factory's existing ERP logo becomes the first row of its logo history (D-428).
INSERT INTO "document_brand_marks" ("owner_kind", "factory_id", "kind", "file_id", "created_at", "created_by")
SELECT 'factory', s."factory_id", 'logo', s."document_logo_file_id", s."updated_at", COALESCE(s."updated_by", f."created_by")
FROM "erp_factory_settings" s JOIN "factories" f ON f."id" = s."factory_id"
WHERE s."document_logo_file_id" IS NOT NULL AND COALESCE(s."updated_by", f."created_by") IS NOT NULL;

-- An issued document stays frozen; D-431 adds its cancelled copy once, like its PDF.
CREATE OR REPLACE FUNCTION tg_customer_documents__issued_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'customer documents are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'void_reason' - 'voided_at' - 'voided_by' - 'pdf_file_id' - 'pdf_sha256'
                    - 'e_tax_status' - 'e_tax_xml_file_id' - 'legal_hold' - 'cancelled_pdf_file_id')
     <> (to_jsonb(OLD) - 'status' - 'void_reason' - 'voided_at' - 'voided_by' - 'pdf_file_id' - 'pdf_sha256'
                    - 'e_tax_status' - 'e_tax_xml_file_id' - 'legal_hold' - 'cancelled_pdf_file_id')
     OR (OLD.status = 'void' AND NEW.status <> 'void')
     OR (OLD.pdf_file_id IS NOT NULL AND NEW.pdf_file_id IS DISTINCT FROM OLD.pdf_file_id)
     OR (OLD.cancelled_pdf_file_id IS NOT NULL AND NEW.cancelled_pdf_file_id IS DISTINCT FROM OLD.cancelled_pdf_file_id) THEN
    RAISE EXCEPTION 'customer document % is issued and cannot change', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
