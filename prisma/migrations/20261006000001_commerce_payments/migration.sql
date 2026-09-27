-- B3.2 payment schedules, payments, slips and refunds (docs/schema-design.md §3.6; D-020, D-061, D-169, ADR-0008).

-- CreateEnum
CREATE TYPE "due_trigger" AS ENUM ('at_checkout', 'before_production', 'before_shipping', 'on_delivery', 'days_after_delivery');

-- CreateEnum
CREATE TYPE "required_before" AS ENUM ('none', 'production', 'shipping');

-- CreateEnum
CREATE TYPE "instalment_status" AS ENUM ('pending', 'due', 'partially_paid', 'paid', 'overdue', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('scb_qr', 'scb_qr_cross_bank', 'card_2c2p', 'online_banking_2c2p', 'bank_transfer_slip', 'store_credit', 'credit_term_transfer', 'card_instalment_2c2p', 'scb_direct_debit');

-- CreateEnum
CREATE TYPE "payment_provider" AS ENUM ('scb', 'twoc2p', 'slip', 'bank', 'internal');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('initiated', 'pending', 'awaiting_verification', 'succeeded', 'failed', 'cancelled', 'expired', 'refunded', 'partially_refunded');

-- CreateEnum
CREATE TYPE "upload_channel" AS ENUM ('web', 'line_liff', 'cs');

-- CreateEnum
CREATE TYPE "slip_status" AS ENUM ('pending', 'passed', 'failed', 'manual_review', 'manual_approved', 'manual_rejected');

-- CreateEnum
CREATE TYPE "slip_check_result" AS ENUM ('pass', 'mismatch', 'duplicate', 'unreadable', 'provider_error');

-- CreateEnum
CREATE TYPE "refund_channel" AS ENUM ('original_gateway', 'bank_transfer', 'store_credit');

-- CreateEnum
CREATE TYPE "refund_status" AS ENUM ('requested', 'pending_approval', 'approved', 'processing', 'succeeded', 'failed', 'rejected');

-- CreateTable
CREATE TABLE "payment_schedule_templates" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "key" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "decision_refs" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,

    CONSTRAINT "pk_payment_schedule_templates" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_schedule_template_versions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "template_id" BIGINT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "status" "config_version_status" NOT NULL DEFAULT 'draft',
    "selection_rule" JSONB NOT NULL,
    "priority" SMALLINT NOT NULL,
    "requires_permission_to_select" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "approval_request_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" BIGINT,

    CONSTRAINT "pk_payment_schedule_template_versions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_schedule_template_instalments" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "template_version_id" BIGINT NOT NULL,
    "seq" SMALLINT NOT NULL,
    "label_th" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "pct" DECIMAL(7,4) NOT NULL,
    "due_trigger" "due_trigger" NOT NULL,
    "due_offset_days" SMALLINT,
    "required_before" "required_before" NOT NULL,

    CONSTRAINT "pk_payment_schedule_template_instalments" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_schedules" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "order_group_id" BIGINT NOT NULL,
    "template_version_id" BIGINT NOT NULL,
    "is_override" BOOLEAN NOT NULL DEFAULT false,
    "override_reason" TEXT,
    "override_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_payment_schedules" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instalments" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "payment_schedule_id" BIGINT NOT NULL,
    "seq" SMALLINT NOT NULL,
    "label_th" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "pct" DECIMAL(7,4) NOT NULL,
    "due_trigger" "due_trigger" NOT NULL,
    "due_offset_days" SMALLINT,
    "required_before" "required_before" NOT NULL,
    "due_at" TIMESTAMPTZ(6),
    "net_amount" DECIMAL(14,2) NOT NULL,
    "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "wht_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cash_amount" DECIMAL(14,2) NOT NULL,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "instalment_status" NOT NULL DEFAULT 'pending',
    "paid_at" TIMESTAMPTZ(6),
    "overdue_notified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_instalments" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instalment_allocations" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "instalment_id" BIGINT NOT NULL,
    "order_id" BIGINT NOT NULL,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "wht_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cash_amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "pk_instalment_allocations" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "order_group_id" BIGINT,
    "method" "payment_method" NOT NULL,
    "provider" "payment_provider" NOT NULL,
    "status" "payment_status" NOT NULL,
    "reference_code" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "wht_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cash_amount" DECIMAL(14,2) NOT NULL,
    "fee_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "refunded_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "provider_ref" TEXT,
    "provider_payload" JSONB,
    "qr_payload" TEXT,
    "redirect_url" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "verified_at" TIMESTAMPTZ(6),
    "verified_by" BIGINT,
    "initiated_by" BIGINT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_payments" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "payment_id" BIGINT NOT NULL,
    "instalment_id" BIGINT NOT NULL,
    "cash_amount" DECIMAL(14,2) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_payment_allocations" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slips" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "payment_id" BIGINT NOT NULL,
    "file_object_id" BIGINT NOT NULL,
    "uploaded_via" "upload_channel" NOT NULL,
    "declared_amount" DECIMAL(14,2) NOT NULL,
    "declared_transferred_at" TIMESTAMPTZ(6) NOT NULL,
    "verification_status" "slip_status" NOT NULL DEFAULT 'pending',
    "bank_trans_ref" TEXT,
    "sla_due_at" TIMESTAMPTZ(6),
    "reviewed_by" BIGINT,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,

    CONSTRAINT "pk_slips" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slip_verifications" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "slip_id" BIGINT NOT NULL,
    "provider" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" "slip_check_result" NOT NULL,
    "receiver_matched" BOOLEAN NOT NULL,
    "amount_matched" BOOLEAN NOT NULL,
    "date_matched" BOOLEAN NOT NULL,
    "trans_ref" TEXT,
    "response" JSONB NOT NULL,

    CONSTRAINT "pk_slip_verifications" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "payment_id" BIGINT NOT NULL,
    "order_id" BIGINT,
    "amount" DECIMAL(14,2) NOT NULL,
    "cancel_reason_id" BIGINT,
    "reason_note" TEXT NOT NULL,
    "channel" "refund_channel" NOT NULL,
    "status" "refund_status" NOT NULL DEFAULT 'requested',
    "approval_request_id" BIGINT,
    "provider_ref" TEXT,
    "failure_reason" TEXT,
    "requested_by" BIGINT NOT NULL,
    "decided_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "completed_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_refunds" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_payment_schedule_templates__public_id" ON "payment_schedule_templates"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_payment_schedule_templates__key" ON "payment_schedule_templates"("key");

-- CreateIndex
CREATE INDEX "ix_payment_schedule_templates__created_by" ON "payment_schedule_templates"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_payment_schedule_template_versions__public_id" ON "payment_schedule_template_versions"("public_id");

-- CreateIndex
CREATE INDEX "ix_payment_schedule_template_versions__resolution" ON "payment_schedule_template_versions"("template_id", "effective_from" DESC, "version_no" DESC) WHERE (status = 'approved'::config_version_status);

-- CreateIndex
CREATE INDEX "ix_payment_schedule_template_versions__approval_request_id" ON "payment_schedule_template_versions"("approval_request_id");

-- CreateIndex
CREATE INDEX "ix_payment_schedule_template_versions__created_by" ON "payment_schedule_template_versions"("created_by");

-- CreateIndex
CREATE INDEX "ix_payment_schedule_template_versions__decided_by" ON "payment_schedule_template_versions"("decided_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_payment_schedule_template_versions__template_id__version_no" ON "payment_schedule_template_versions"("template_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_payment_schedule_template_instalments__version__seq" ON "payment_schedule_template_instalments"("template_version_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ux_payment_schedules__public_id" ON "payment_schedules"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_payment_schedules__order_group_id" ON "payment_schedules"("order_group_id");

-- CreateIndex
CREATE INDEX "ix_payment_schedules__template_version_id" ON "payment_schedules"("template_version_id");

-- CreateIndex
CREATE INDEX "ix_payment_schedules__override_by" ON "payment_schedules"("override_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_instalments__public_id" ON "instalments"("public_id");

-- CreateIndex
CREATE INDEX "ix_instalments__status__due_at" ON "instalments"("status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "ux_instalments__payment_schedule_id__seq" ON "instalments"("payment_schedule_id", "seq");

-- CreateIndex
CREATE INDEX "ix_instalment_allocations__order_id" ON "instalment_allocations"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_instalment_allocations__instalment_id__order_id" ON "instalment_allocations"("instalment_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_payments__public_id" ON "payments"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_payments__reference_code" ON "payments"("reference_code");

-- CreateIndex
CREATE INDEX "ix_payments__order_group_id__status" ON "payments"("order_group_id", "status");

-- CreateIndex
CREATE INDEX "ix_payments__status__expires_at" ON "payments"("status", "expires_at");

-- CreateIndex
CREATE INDEX "ix_payments__entity_id" ON "payments"("entity_id");

-- CreateIndex
CREATE INDEX "ix_payments__verified_by" ON "payments"("verified_by");

-- CreateIndex
CREATE INDEX "ix_payments__initiated_by" ON "payments"("initiated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_payments__provider__provider_ref" ON "payments"("provider", "provider_ref") WHERE (provider_ref IS NOT NULL);

-- CreateIndex
CREATE INDEX "ix_payment_allocations__instalment_id" ON "payment_allocations"("instalment_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_payment_allocations__payment_id__instalment_id" ON "payment_allocations"("payment_id", "instalment_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_slips__public_id" ON "slips"("public_id");

-- CreateIndex
CREATE INDEX "ix_slips__payment_id" ON "slips"("payment_id");

-- CreateIndex
CREATE INDEX "ix_slips__verification_status__sla_due_at" ON "slips"("verification_status", "sla_due_at");

-- CreateIndex
CREATE INDEX "ix_slips__file_object_id" ON "slips"("file_object_id");

-- CreateIndex
CREATE INDEX "ix_slips__reviewed_by" ON "slips"("reviewed_by");

-- CreateIndex
CREATE INDEX "ix_slips__created_by" ON "slips"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_slips__bank_trans_ref" ON "slips"("bank_trans_ref") WHERE (verification_status = ANY (ARRAY['passed'::slip_status, 'manual_approved'::slip_status]));

-- CreateIndex
CREATE INDEX "ix_slip_verifications__slip_id" ON "slip_verifications"("slip_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_refunds__public_id" ON "refunds"("public_id");

-- CreateIndex
CREATE INDEX "ix_refunds__payment_id" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "ix_refunds__status" ON "refunds"("status");

-- CreateIndex
CREATE INDEX "ix_refunds__entity_id" ON "refunds"("entity_id");

-- CreateIndex
CREATE INDEX "ix_refunds__order_id" ON "refunds"("order_id");

-- CreateIndex
CREATE INDEX "ix_refunds__cancel_reason_id" ON "refunds"("cancel_reason_id");

-- CreateIndex
CREATE INDEX "ix_refunds__approval_request_id" ON "refunds"("approval_request_id");

-- CreateIndex
CREATE INDEX "ix_refunds__requested_by" ON "refunds"("requested_by");

-- CreateIndex
CREATE INDEX "ix_refunds__completed_by" ON "refunds"("completed_by");

-- AddForeignKey
ALTER TABLE "payment_schedule_templates" ADD CONSTRAINT "fk_payment_schedule_templates__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_schedule_template_versions" ADD CONSTRAINT "fk_payment_schedule_template_versions__template_id" FOREIGN KEY ("template_id") REFERENCES "payment_schedule_templates"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_schedule_template_versions" ADD CONSTRAINT "fk_payment_schedule_template_versions__approval_request_id" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_schedule_template_versions" ADD CONSTRAINT "fk_payment_schedule_template_versions__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_schedule_template_versions" ADD CONSTRAINT "fk_payment_schedule_template_versions__decided_by" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_schedule_template_instalments" ADD CONSTRAINT "fk_payment_schedule_template_instalments__template_version_id" FOREIGN KEY ("template_version_id") REFERENCES "payment_schedule_template_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_schedules" ADD CONSTRAINT "fk_payment_schedules__order_group_id" FOREIGN KEY ("order_group_id") REFERENCES "order_groups"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_schedules" ADD CONSTRAINT "fk_payment_schedules__template_version_id" FOREIGN KEY ("template_version_id") REFERENCES "payment_schedule_template_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_schedules" ADD CONSTRAINT "fk_payment_schedules__override_by" FOREIGN KEY ("override_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "instalments" ADD CONSTRAINT "fk_instalments__payment_schedule_id" FOREIGN KEY ("payment_schedule_id") REFERENCES "payment_schedules"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "instalment_allocations" ADD CONSTRAINT "fk_instalment_allocations__instalment_id" FOREIGN KEY ("instalment_id") REFERENCES "instalments"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "instalment_allocations" ADD CONSTRAINT "fk_instalment_allocations__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "fk_payments__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "fk_payments__order_group_id" FOREIGN KEY ("order_group_id") REFERENCES "order_groups"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "fk_payments__verified_by" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "fk_payments__initiated_by" FOREIGN KEY ("initiated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "fk_payment_allocations__payment_id" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "fk_payment_allocations__instalment_id" FOREIGN KEY ("instalment_id") REFERENCES "instalments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slips" ADD CONSTRAINT "fk_slips__payment_id" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slips" ADD CONSTRAINT "fk_slips__file_object_id" FOREIGN KEY ("file_object_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slips" ADD CONSTRAINT "fk_slips__reviewed_by" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slips" ADD CONSTRAINT "fk_slips__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "slip_verifications" ADD CONSTRAINT "fk_slip_verifications__slip_id" FOREIGN KEY ("slip_id") REFERENCES "slips"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "fk_refunds__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "fk_refunds__payment_id" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "fk_refunds__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "fk_refunds__cancel_reason_id" FOREIGN KEY ("cancel_reason_id") REFERENCES "order_cancel_reasons"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "fk_refunds__approval_request_id" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "fk_refunds__requested_by" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "fk_refunds__completed_by" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- --- hand-written (Prisma cannot express these) --------------------------------------------------

-- --- payment schedule templates (D-020, schema-design §2.1) --------------------------------------
ALTER TABLE payment_schedule_templates
  ADD CONSTRAINT ck_payment_schedule_templates__key CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  ADD CONSTRAINT ck_payment_schedule_templates__decision_refs CHECK (cardinality(decision_refs) >= 1);

ALTER TABLE payment_schedule_template_versions
  ADD CONSTRAINT ck_payment_schedule_template_versions__version_no CHECK (version_no > 0),
  ADD CONSTRAINT ck_payment_schedule_template_versions__reason CHECK (btrim(reason) <> ''),
  ADD CONSTRAINT ck_payment_schedule_template_versions__priority CHECK (priority >= 0),
  ADD CONSTRAINT ck_payment_schedule_template_versions__decided CHECK (
    status NOT IN ('approved', 'rejected') OR decided_at IS NOT NULL
  ),
  ADD CONSTRAINT ck_payment_schedule_template_versions__status CHECK (status <> 'pending_acceptance');
CREATE TRIGGER tg_payment_schedule_template_versions__immutable BEFORE UPDATE OR DELETE ON payment_schedule_template_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_version_change();

ALTER TABLE payment_schedule_template_instalments
  ADD CONSTRAINT ck_payment_schedule_template_instalments__seq CHECK (seq > 0),
  ADD CONSTRAINT ck_payment_schedule_template_instalments__pct CHECK (pct > 0 AND pct <= 100),
  ADD CONSTRAINT ck_payment_schedule_template_instalments__labels CHECK (btrim(label_th) <> '' AND btrim(label_en) <> ''),
  ADD CONSTRAINT ck_payment_schedule_template_instalments__offset CHECK (
    (due_offset_days IS NULL OR due_offset_days >= 0)
    AND (due_trigger <> 'days_after_delivery' OR due_offset_days IS NOT NULL)
  );

-- Instalments are part of their version: written while the version is a draft, frozen once proposed.
CREATE FUNCTION forbid_decided_template_instalment_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  version_status config_version_status;
BEGIN
  SELECT status INTO version_status FROM payment_schedule_template_versions
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.template_version_id ELSE NEW.template_version_id END;
  IF version_status IS NOT NULL AND version_status <> 'draft' THEN
    RAISE EXCEPTION 'instalments of a % template version cannot be changed', version_status
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER tg_payment_schedule_template_instalments__draft_only
  BEFORE INSERT OR UPDATE OR DELETE ON payment_schedule_template_instalments
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_template_instalment_change();

-- A proposed or approved version's instalments add up to 100 % (checked at commit, so a version and
-- its instalments can be written in one transaction).
CREATE FUNCTION check_template_instalments_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  total numeric;
  version_status config_version_status;
BEGIN
  SELECT status INTO version_status FROM payment_schedule_template_versions WHERE id = NEW.id;
  IF version_status IN ('proposed', 'approved') THEN
    SELECT coalesce(sum(pct), 0) INTO total FROM payment_schedule_template_instalments
      WHERE template_version_id = NEW.id;
    IF total <> 100 THEN
      RAISE EXCEPTION 'template version % instalments add up to % %%, not 100 %%', NEW.id, total
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER tg_payment_schedule_template_versions__total_100
  AFTER INSERT OR UPDATE ON payment_schedule_template_versions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_template_instalments_total();

-- --- schedules & instalments (ADR-0008) -----------------------------------------------------------
ALTER TABLE payment_schedules
  ADD CONSTRAINT ck_payment_schedules__override CHECK (
    NOT is_override OR (override_reason IS NOT NULL AND btrim(override_reason) <> '' AND override_by IS NOT NULL)
  );
CREATE TRIGGER tg_payment_schedules__no_delete BEFORE DELETE ON payment_schedules
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE instalments
  ADD CONSTRAINT ck_instalments__seq CHECK (seq > 0),
  ADD CONSTRAINT ck_instalments__pct CHECK (pct >= 0 AND pct <= 100),
  ADD CONSTRAINT ck_instalments__amounts CHECK (
    net_amount >= 0 AND discount_amount >= 0 AND vat_amount >= 0 AND wht_amount >= 0 AND paid_amount >= 0
  ),
  ADD CONSTRAINT ck_instalments__gross CHECK (gross_amount = net_amount - discount_amount + vat_amount),
  ADD CONSTRAINT ck_instalments__cash CHECK (cash_amount = gross_amount - wht_amount),
  ADD CONSTRAINT ck_instalments__paid CHECK (paid_amount <= cash_amount),
  ADD CONSTRAINT ck_instalments__paid_status CHECK (
    (status <> 'paid' OR (paid_amount = cash_amount AND paid_at IS NOT NULL))
    AND (status <> 'partially_paid' OR (paid_amount > 0 AND paid_amount < cash_amount))
  ),
  ADD CONSTRAINT ck_instalments__offset CHECK (
    due_offset_days IS NULL OR due_offset_days >= 0
  );
CREATE TRIGGER tg_instalments__no_delete BEFORE DELETE ON instalments
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE instalment_allocations
  ADD CONSTRAINT ck_instalment_allocations__amounts CHECK (
    net_amount >= 0 AND vat_amount >= 0 AND gross_amount >= 0 AND wht_amount >= 0
  ),
  ADD CONSTRAINT ck_instalment_allocations__cash CHECK (cash_amount = gross_amount - wht_amount);

-- --- payments (D-061) -----------------------------------------------------------------------------
ALTER TABLE payments
  -- Echoed by providers as SCB ref1 / QR CS invoice / 2C2P invoiceNo: upper-case alphanumerics, ≤ 20.
  ADD CONSTRAINT ck_payments__reference_code CHECK (reference_code ~ '^[A-Z0-9]{8,20}$'),
  ADD CONSTRAINT ck_payments__amounts CHECK (
    amount >= 0 AND wht_amount >= 0 AND fee_amount >= 0 AND refunded_amount >= 0
  ),
  ADD CONSTRAINT ck_payments__cash CHECK (cash_amount = amount - wht_amount),
  ADD CONSTRAINT ck_payments__refunded CHECK (refunded_amount <= cash_amount),
  ADD CONSTRAINT ck_payments__paid CHECK (
    status NOT IN ('succeeded', 'refunded', 'partially_refunded') OR paid_at IS NOT NULL
  );
CREATE TRIGGER tg_payments__no_delete BEFORE DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE payment_allocations
  ADD CONSTRAINT ck_payment_allocations__amounts CHECK (cash_amount > 0 AND gross_amount >= cash_amount);
CREATE TRIGGER tg_payment_allocations__append_only BEFORE UPDATE OR DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_row_change();

ALTER TABLE slips
  ADD CONSTRAINT ck_slips__declared_amount CHECK (declared_amount > 0),
  ADD CONSTRAINT ck_slips__reviewed CHECK (
    verification_status NOT IN ('manual_approved', 'manual_rejected')
    OR (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  );
CREATE TRIGGER tg_slips__no_delete BEFORE DELETE ON slips
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

CREATE TRIGGER tg_slip_verifications__append_only BEFORE UPDATE OR DELETE ON slip_verifications
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_row_change();

ALTER TABLE refunds
  ADD CONSTRAINT ck_refunds__amount CHECK (amount > 0),
  ADD CONSTRAINT ck_refunds__reason CHECK (btrim(reason_note) <> ''),
  ADD CONSTRAINT ck_refunds__completed CHECK (status <> 'succeeded' OR completed_at IS NOT NULL);
CREATE TRIGGER tg_refunds__no_delete BEFORE DELETE ON refunds
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();
