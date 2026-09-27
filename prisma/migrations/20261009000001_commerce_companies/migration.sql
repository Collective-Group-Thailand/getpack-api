-- CreateEnum
CREATE TYPE "company_status" AS ENUM ('applied', 'kyc_review', 'active', 'suspended', 'closed');

-- CreateEnum
CREATE TYPE "credit_status" AS ENUM ('prepaid', 'eligible', 'credit', 'blocked_overdue');

-- CreateEnum
CREATE TYPE "po_number_policy" AS ENUM ('required', 'optional', 'none');

-- CreateEnum
CREATE TYPE "member_status" AS ENUM ('invited', 'active', 'removed');

-- CreateEnum
CREATE TYPE "memo_status" AS ENUM ('draft', 'pending_approval', 'approved', 'rejected', 'withdrawn', 'expired', 'applied');

-- AlterEnum
ALTER TYPE "document_type" ADD VALUE 'company';

-- AlterTable
ALTER TABLE "carts" ADD COLUMN     "company_id" BIGINT;

-- AlterTable
ALTER TABLE "customer_addresses" ADD COLUMN     "company_id" BIGINT;

-- AlterTable
ALTER TABLE "order_discounts" ADD COLUMN     "discount_memo_id" BIGINT;

-- AlterTable
ALTER TABLE "order_groups" ADD COLUMN     "company_approval_request_id" BIGINT,
ADD COLUMN     "company_branch_id" BIGINT,
ADD COLUMN     "company_id" BIGINT,
ADD COLUMN     "discount_memo_id" BIGINT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "company_id" BIGINT;

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "company_id" BIGINT;

-- CreateTable
CREATE TABLE "companies" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "company_code" TEXT,
    "legal_name" TEXT NOT NULL,
    "trade_name" TEXT,
    "tax_id" CHAR(13) NOT NULL,
    "is_vat_registered" BOOLEAN NOT NULL DEFAULT true,
    "withholds_tax" BOOLEAN NOT NULL DEFAULT false,
    "document_email" CITEXT,
    "status" "company_status" NOT NULL DEFAULT 'applied',
    "credit_status" "credit_status" NOT NULL DEFAULT 'prepaid',
    "po_number_policy" "po_number_policy" NOT NULL DEFAULT 'optional',
    "order_approval_threshold" DECIMAL(14,2),
    "paid_orders_count" INTEGER NOT NULL DEFAULT 0,
    "applied_by" BIGINT NOT NULL,
    "kyc_reviewed_by" BIGINT,
    "kyc_approved_at" TIMESTAMPTZ(6),
    "status_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_companies" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_branches" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" BIGINT NOT NULL,
    "branch_type" "branch_type" NOT NULL,
    "branch_code" CHAR(5) NOT NULL,
    "name" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "subdistrict_id" BIGINT,
    "postcode" CHAR(5) NOT NULL,
    "province_id" BIGINT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_company_branches" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_members" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "status" "member_status" NOT NULL DEFAULT 'invited',
    "role_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "invited_by" BIGINT,
    "invited_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joined_at" TIMESTAMPTZ(6),
    "removed_at" TIMESTAMPTZ(6),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_company_members" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_kyc_documents" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" BIGINT NOT NULL,
    "doc_type" "kyc_doc_type" NOT NULL,
    "file_object_id" BIGINT NOT NULL,
    "issued_on" DATE,
    "status" "kyc_status" NOT NULL DEFAULT 'pending',
    "verified_by" BIGINT,
    "verified_at" TIMESTAMPTZ(6),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_company_kyc_documents" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_credit_limits" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_company_credit_limits" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_credit_limit_versions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "credit_limit_id" BIGINT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "status" "config_version_status" NOT NULL DEFAULT 'draft',
    "limit_amount" DECIMAL(14,2) NOT NULL,
    "term_days" SMALLINT NOT NULL,
    "eligibility_basis" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "approval_request_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_company_credit_limit_versions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_discounts" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_company_discounts" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_discount_versions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "discount_id" BIGINT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "valid_to" TIMESTAMPTZ(6),
    "status" "config_version_status" NOT NULL DEFAULT 'draft',
    "discount_pct" DECIMAL(7,4) NOT NULL,
    "discount_memo_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_company_discount_versions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_memos" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "scope" TEXT NOT NULL,
    "requested_by" BIGINT NOT NULL,
    "customer_user_id" BIGINT,
    "company_id" BIGINT,
    "quote_id" BIGINT,
    "cart_id" BIGINT,
    "order_value" DECIMAL(14,2) NOT NULL,
    "requested_pct" DECIMAL(7,4) NOT NULL,
    "requested_amount" DECIMAL(14,2) NOT NULL,
    "resulting_margin_pct" DECIMAL(9,4),
    "below_margin_floor" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "evidence_file_ids" BIGINT[] DEFAULT ARRAY[]::BIGINT[],
    "status" "memo_status" NOT NULL DEFAULT 'pending_approval',
    "approval_request_id" BIGINT,
    "approved_pct" DECIMAL(7,4),
    "valid_until" TIMESTAMPTZ(6) NOT NULL,
    "decided_at" TIMESTAMPTZ(6),
    "applied_order_group_id" BIGINT,
    "applied_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_discount_memos" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_companies__public_id" ON "companies"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_companies__company_code" ON "companies"("company_code");

-- CreateIndex
CREATE INDEX "ix_companies__status" ON "companies"("status");

-- CreateIndex
CREATE INDEX "ix_companies__entity_id" ON "companies"("entity_id");

-- CreateIndex
CREATE INDEX "ix_companies__applied_by" ON "companies"("applied_by");

-- CreateIndex
CREATE INDEX "ix_companies__kyc_reviewed_by" ON "companies"("kyc_reviewed_by");

-- CreateIndex
CREATE INDEX "ix_companies__updated_by" ON "companies"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_companies__tax_id" ON "companies"("tax_id") WHERE (status <> 'closed'::company_status);

-- CreateIndex
CREATE UNIQUE INDEX "ux_company_branches__public_id" ON "company_branches"("public_id");

-- CreateIndex
CREATE INDEX "ix_company_branches__company_id" ON "company_branches"("company_id");

-- CreateIndex
CREATE INDEX "ix_company_branches__subdistrict_id" ON "company_branches"("subdistrict_id");

-- CreateIndex
CREATE INDEX "ix_company_branches__province_id" ON "company_branches"("province_id");

-- CreateIndex
CREATE INDEX "ix_company_branches__created_by" ON "company_branches"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_company_branches__company_id__branch_code" ON "company_branches"("company_id", "branch_code") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "ux_company_branches__one_default" ON "company_branches"("company_id") WHERE (is_default AND (deleted_at IS NULL));

-- CreateIndex
CREATE UNIQUE INDEX "ux_company_members__public_id" ON "company_members"("public_id");

-- CreateIndex
CREATE INDEX "ix_company_members__user_id" ON "company_members"("user_id");

-- CreateIndex
CREATE INDEX "ix_company_members__invited_by" ON "company_members"("invited_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_company_members__company_id__user_id" ON "company_members"("company_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_company_kyc_documents__public_id" ON "company_kyc_documents"("public_id");

-- CreateIndex
CREATE INDEX "ix_company_kyc_documents__company_id__doc_type" ON "company_kyc_documents"("company_id", "doc_type");

-- CreateIndex
CREATE INDEX "ix_company_kyc_documents__file_object_id" ON "company_kyc_documents"("file_object_id");

-- CreateIndex
CREATE INDEX "ix_company_kyc_documents__verified_by" ON "company_kyc_documents"("verified_by");

-- CreateIndex
CREATE INDEX "ix_company_kyc_documents__created_by" ON "company_kyc_documents"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_company_credit_limits__public_id" ON "company_credit_limits"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_company_credit_limits__company_id" ON "company_credit_limits"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_company_credit_limit_versions__public_id" ON "company_credit_limit_versions"("public_id");

-- CreateIndex
CREATE INDEX "ix_company_credit_limit_versions__resolution" ON "company_credit_limit_versions"("credit_limit_id", "effective_from" DESC, "version_no" DESC) WHERE (status = 'approved'::config_version_status);

-- CreateIndex
CREATE INDEX "ix_company_credit_limit_versions__approval_request_id" ON "company_credit_limit_versions"("approval_request_id");

-- CreateIndex
CREATE INDEX "ix_company_credit_limit_versions__created_by" ON "company_credit_limit_versions"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_company_credit_limit_versions__credit_limit_id__version_no" ON "company_credit_limit_versions"("credit_limit_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_company_discounts__public_id" ON "company_discounts"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_company_discounts__company_id" ON "company_discounts"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_company_discount_versions__public_id" ON "company_discount_versions"("public_id");

-- CreateIndex
CREATE INDEX "ix_company_discount_versions__resolution" ON "company_discount_versions"("discount_id", "effective_from" DESC, "version_no" DESC) WHERE (status = 'approved'::config_version_status);

-- CreateIndex
CREATE INDEX "ix_company_discount_versions__discount_memo_id" ON "company_discount_versions"("discount_memo_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_company_discount_versions__discount_id__version_no" ON "company_discount_versions"("discount_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_discount_memos__public_id" ON "discount_memos"("public_id");

-- CreateIndex
CREATE INDEX "ix_discount_memos__status__valid_until" ON "discount_memos"("status", "valid_until");

-- CreateIndex
CREATE INDEX "ix_discount_memos__entity_id" ON "discount_memos"("entity_id");

-- CreateIndex
CREATE INDEX "ix_discount_memos__requested_by" ON "discount_memos"("requested_by");

-- CreateIndex
CREATE INDEX "ix_discount_memos__customer_user_id" ON "discount_memos"("customer_user_id");

-- CreateIndex
CREATE INDEX "ix_discount_memos__company_id" ON "discount_memos"("company_id");

-- CreateIndex
CREATE INDEX "ix_discount_memos__quote_id" ON "discount_memos"("quote_id");

-- CreateIndex
CREATE INDEX "ix_discount_memos__cart_id" ON "discount_memos"("cart_id");

-- CreateIndex
CREATE INDEX "ix_discount_memos__approval_request_id" ON "discount_memos"("approval_request_id");

-- CreateIndex
CREATE INDEX "ix_discount_memos__applied_order_group_id" ON "discount_memos"("applied_order_group_id");

-- CreateIndex
CREATE INDEX "ix_carts__company_id" ON "carts"("company_id");

-- CreateIndex
CREATE INDEX "ix_customer_addresses__company_id" ON "customer_addresses"("company_id");

-- CreateIndex
CREATE INDEX "ix_order_discounts__discount_memo_id" ON "order_discounts"("discount_memo_id");

-- CreateIndex
CREATE INDEX "ix_order_groups__company_id__created_at" ON "order_groups"("company_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_order_groups__company_branch_id" ON "order_groups"("company_branch_id");

-- CreateIndex
CREATE INDEX "ix_order_groups__company_approval_request_id" ON "order_groups"("company_approval_request_id");

-- CreateIndex
CREATE INDEX "ix_order_groups__discount_memo_id" ON "order_groups"("discount_memo_id");

-- CreateIndex
CREATE INDEX "ix_orders__company_id__created_at" ON "orders"("company_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_quotes__company_id" ON "quotes"("company_id");

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "fk_customer_addresses__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "fk_carts__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_groups" ADD CONSTRAINT "fk_order_groups__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_groups" ADD CONSTRAINT "fk_order_groups__company_branch_id" FOREIGN KEY ("company_branch_id") REFERENCES "company_branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_groups" ADD CONSTRAINT "fk_order_groups__company_approval_request_id" FOREIGN KEY ("company_approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_groups" ADD CONSTRAINT "fk_order_groups__discount_memo_id" FOREIGN KEY ("discount_memo_id") REFERENCES "discount_memos"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "fk_orders__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_discounts" ADD CONSTRAINT "fk_order_discounts__discount_memo_id" FOREIGN KEY ("discount_memo_id") REFERENCES "discount_memos"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "fk_companies__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "fk_companies__applied_by" FOREIGN KEY ("applied_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "fk_companies__kyc_reviewed_by" FOREIGN KEY ("kyc_reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "fk_companies__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_branches" ADD CONSTRAINT "fk_company_branches__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_branches" ADD CONSTRAINT "fk_company_branches__subdistrict_id" FOREIGN KEY ("subdistrict_id") REFERENCES "geo_subdistricts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_branches" ADD CONSTRAINT "fk_company_branches__province_id" FOREIGN KEY ("province_id") REFERENCES "geo_provinces"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_branches" ADD CONSTRAINT "fk_company_branches__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_members" ADD CONSTRAINT "fk_company_members__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_members" ADD CONSTRAINT "fk_company_members__user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_members" ADD CONSTRAINT "fk_company_members__invited_by" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_kyc_documents" ADD CONSTRAINT "fk_company_kyc_documents__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_kyc_documents" ADD CONSTRAINT "fk_company_kyc_documents__file_object_id" FOREIGN KEY ("file_object_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_kyc_documents" ADD CONSTRAINT "fk_company_kyc_documents__verified_by" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_kyc_documents" ADD CONSTRAINT "fk_company_kyc_documents__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_credit_limits" ADD CONSTRAINT "fk_company_credit_limits__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_credit_limit_versions" ADD CONSTRAINT "fk_company_credit_limit_versions__credit_limit_id" FOREIGN KEY ("credit_limit_id") REFERENCES "company_credit_limits"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_credit_limit_versions" ADD CONSTRAINT "fk_company_credit_limit_versions__approval_request_id" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_credit_limit_versions" ADD CONSTRAINT "fk_company_credit_limit_versions__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_discounts" ADD CONSTRAINT "fk_company_discounts__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_discount_versions" ADD CONSTRAINT "fk_company_discount_versions__discount_id" FOREIGN KEY ("discount_id") REFERENCES "company_discounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "company_discount_versions" ADD CONSTRAINT "fk_company_discount_versions__discount_memo_id" FOREIGN KEY ("discount_memo_id") REFERENCES "discount_memos"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "discount_memos" ADD CONSTRAINT "fk_discount_memos__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "discount_memos" ADD CONSTRAINT "fk_discount_memos__requested_by" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "discount_memos" ADD CONSTRAINT "fk_discount_memos__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "discount_memos" ADD CONSTRAINT "fk_discount_memos__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "discount_memos" ADD CONSTRAINT "fk_discount_memos__quote_id" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "discount_memos" ADD CONSTRAINT "fk_discount_memos__cart_id" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "discount_memos" ADD CONSTRAINT "fk_discount_memos__approval_request_id" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "discount_memos" ADD CONSTRAINT "fk_discount_memos__applied_order_group_id" FOREIGN KEY ("applied_order_group_id") REFERENCES "order_groups"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "file_objects" ADD CONSTRAINT "fk_file_objects__owner_company_id" FOREIGN KEY ("owner_company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "fk_quotes__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- =====================================================================================================
-- Hand-written: companies, credit and discount-memo guards (D-120…D-125, D-052; schema-design A-35)
-- =====================================================================================================

ALTER TABLE companies
  ADD CONSTRAINT ck_companies__legal_name CHECK (btrim(legal_name) <> ''),
  ADD CONSTRAINT ck_companies__tax_id CHECK (tax_id ~ '^[0-9]{13}$'),
  ADD CONSTRAINT ck_companies__threshold CHECK (order_approval_threshold IS NULL OR order_approval_threshold >= 0),
  ADD CONSTRAINT ck_companies__paid_orders CHECK (paid_orders_count >= 0),
  ADD CONSTRAINT ck_companies__active_kyc CHECK (status NOT IN ('active', 'suspended') OR kyc_approved_at IS NOT NULL),
  ADD CONSTRAINT ck_companies__credit_needs_active CHECK (credit_status IN ('prepaid', 'eligible') OR status IN ('active', 'suspended'));
CREATE TRIGGER tg_companies__no_delete BEFORE DELETE ON companies
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE company_branches
  ADD CONSTRAINT ck_company_branches__code CHECK (branch_code ~ '^[0-9]{5}$'),
  ADD CONSTRAINT ck_company_branches__head_office CHECK (branch_type <> 'head_office' OR branch_code = '00000'),
  ADD CONSTRAINT ck_company_branches__name CHECK (btrim(name) <> '');

ALTER TABLE company_members
  ADD CONSTRAINT ck_company_members__joined CHECK (status <> 'active' OR joined_at IS NOT NULL),
  ADD CONSTRAINT ck_company_members__removed CHECK ((status = 'removed') = (removed_at IS NOT NULL));
CREATE TRIGGER tg_company_members__no_delete BEFORE DELETE ON company_members
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

CREATE TRIGGER tg_company_kyc_documents__no_delete BEFORE DELETE ON company_kyc_documents
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

-- --- credit limits (D-121): a version's terms are frozen once it leaves draft ------------------------
ALTER TABLE company_credit_limit_versions
  ADD CONSTRAINT ck_company_credit_limit_versions__amount CHECK (limit_amount >= 0),
  ADD CONSTRAINT ck_company_credit_limit_versions__term CHECK (term_days > 0),
  ADD CONSTRAINT ck_company_credit_limit_versions__reason CHECK (btrim(reason) <> '' AND btrim(eligibility_basis) <> ''),
  ADD CONSTRAINT ck_company_credit_limit_versions__decided CHECK (status NOT IN ('approved', 'rejected') OR decided_at IS NOT NULL);

CREATE FUNCTION tg_company_versions__frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows are never deleted', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status IN ('approved', 'rejected', 'withdrawn')
     AND (to_jsonb(NEW) - 'status' - 'decided_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'decided_at') THEN
    RAISE EXCEPTION 'a decided % row is frozen', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status IN ('approved', 'rejected', 'withdrawn') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'a decided % row keeps its status', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_company_credit_limit_versions__frozen BEFORE UPDATE OR DELETE ON company_credit_limit_versions
  FOR EACH ROW EXECUTE FUNCTION tg_company_versions__frozen();

ALTER TABLE company_discount_versions
  ADD CONSTRAINT ck_company_discount_versions__pct CHECK (discount_pct > 0 AND discount_pct <= 100),
  ADD CONSTRAINT ck_company_discount_versions__window CHECK (valid_to IS NULL OR valid_to > effective_from);
CREATE TRIGGER tg_company_discount_versions__frozen BEFORE UPDATE OR DELETE ON company_discount_versions
  FOR EACH ROW EXECUTE FUNCTION tg_company_versions__frozen();

-- --- discount memos (D-052, D-124, D-162) --------------------------------------------------------
ALTER TABLE discount_memos
  ADD CONSTRAINT ck_discount_memos__scope CHECK (scope IN ('order', 'company')),
  ADD CONSTRAINT ck_discount_memos__subject CHECK (
    (scope = 'company' AND company_id IS NOT NULL) OR (scope = 'order' AND (customer_user_id IS NOT NULL OR company_id IS NOT NULL))
  ),
  ADD CONSTRAINT ck_discount_memos__amounts CHECK (
    order_value >= 0 AND requested_amount >= 0 AND requested_pct > 0 AND requested_pct <= 100
    AND (approved_pct IS NULL OR (approved_pct > 0 AND approved_pct <= requested_pct))
  ),
  ADD CONSTRAINT ck_discount_memos__reason CHECK (btrim(reason) <> ''),
  ADD CONSTRAINT ck_discount_memos__decided CHECK (status NOT IN ('approved', 'rejected', 'applied') OR decided_at IS NOT NULL),
  ADD CONSTRAINT ck_discount_memos__approved_pct CHECK (status NOT IN ('approved', 'applied') OR approved_pct IS NOT NULL),
  ADD CONSTRAINT ck_discount_memos__applied CHECK (
    (status = 'applied') = (applied_at IS NOT NULL) AND (status <> 'applied' OR scope = 'company' OR applied_order_group_id IS NOT NULL)
  );
CREATE TRIGGER tg_discount_memos__no_delete BEFORE DELETE ON discount_memos
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();
