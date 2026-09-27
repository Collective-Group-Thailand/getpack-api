-- CreateEnum
CREATE TYPE "evidence_requirement" AS ENUM ('none', 'photo', 'qc_form', 'photo_and_qc_form');

-- CreateEnum
CREATE TYPE "job_kind" AS ENUM ('production', 'mockup', 'reproduction');

-- CreateEnum
CREATE TYPE "production_job_status" AS ENUM ('released', 'accepted', 'rejected', 'in_progress', 'on_hold', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "assignment_reason" AS ENUM ('initial', 'rejected', 'acceptance_overdue', 'manual');

-- CreateEnum
CREATE TYPE "assignment_mode" AS ENUM ('auto', 'manual', 'escalated');

-- CreateEnum
CREATE TYPE "milestone_status" AS ENUM ('pending', 'in_progress', 'completed', 'skipped');

-- CreateEnum
CREATE TYPE "qc_result" AS ENUM ('pass', 'fail', 'conditional');

-- CreateEnum
CREATE TYPE "inspection_reason" AS ENUM ('value_100_pct', 'value_band_sample', 'trial_factory', 'high_defect_factory', 'special_finish_or_food');

-- CreateEnum
CREATE TYPE "inspection_status" AS ENUM ('planned', 'in_progress', 'passed', 'failed', 'waived');

-- CreateEnum
CREATE TYPE "issue_status" AS ENUM ('open', 'resolved');

-- AlterEnum
ALTER TYPE "attachment_subject" ADD VALUE 'job_issue';

-- CreateTable
CREATE TABLE "milestone_routes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "product_type_id" BIGINT NOT NULL,
    "print_type_id" BIGINT,
    "variant" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,

    CONSTRAINT "pk_milestone_routes" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone_route_versions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "route_id" BIGINT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "status" "config_version_status" NOT NULL DEFAULT 'draft',
    "reason" TEXT NOT NULL,
    "approval_request_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" BIGINT,

    CONSTRAINT "pk_milestone_route_versions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone_route_steps" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "version_id" BIGINT NOT NULL,
    "seq" SMALLINT NOT NULL,
    "key" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "customer_visible" BOOLEAN NOT NULL DEFAULT false,
    "customer_label_th" TEXT,
    "customer_label_en" TEXT,
    "evidence" "evidence_requirement" NOT NULL DEFAULT 'none',
    "tracks_quantity" BOOLEAN NOT NULL DEFAULT false,
    "planned_share_pct" DECIMAL(7,4),

    CONSTRAINT "pk_milestone_route_steps" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_jobs" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "job_no" TEXT NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "order_id" BIGINT NOT NULL,
    "factory_id" BIGINT NOT NULL,
    "job_kind" "job_kind" NOT NULL,
    "reproduction_of_job_id" BIGINT,
    "claim_id" BIGINT,
    "purchase_order_id" BIGINT,
    "order_line_id" BIGINT,
    "status" "production_job_status" NOT NULL DEFAULT 'released',
    "status_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "release_mode" "production_start_mode" NOT NULL,
    "release_reason" TEXT,
    "released_by" BIGINT,
    "accept_due_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "accepted_by" BIGINT,
    "rejected_at" TIMESTAMPTZ(6),
    "rejected_by" BIGINT,
    "reject_reason_code" TEXT,
    "reject_note" TEXT,
    "escalated_at" TIMESTAMPTZ(6),
    "planned_start_on" DATE,
    "planned_finish_on" DATE,
    "promised_ship_date" DATE,
    "predicted_finish_on" DATE,
    "at_risk_since" TIMESTAMPTZ(6),
    "actual_start_at" TIMESTAMPTZ(6),
    "actual_finish_at" TIMESTAMPTZ(6),
    "priority" SMALLINT NOT NULL DEFAULT 0,
    "lot_no" TEXT,
    "quantity_ordered" INTEGER NOT NULL,
    "quantity_good" INTEGER,
    "quantity_scrap" INTEGER,
    "spec_snapshot" JSONB NOT NULL,
    "route_version_id" BIGINT NOT NULL,
    "route_snapshot" JSONB NOT NULL,
    "price_list_version_id" BIGINT,
    "buy_price_snapshot" JSONB NOT NULL,
    "tolerance_shortage_pct" DECIMAL(7,4),
    "tolerance_overage_pct" DECIMAL(7,4),
    "inspection_required" BOOLEAN NOT NULL DEFAULT false,
    "inspection_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hold_reason" TEXT,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_production_jobs" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_assignments" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "job_id" BIGINT NOT NULL,
    "from_factory_id" BIGINT,
    "to_factory_id" BIGINT,
    "reason" "assignment_reason" NOT NULL,
    "margin_after_pct" DECIMAL(9,4),
    "mode" "assignment_mode" NOT NULL,
    "note" TEXT,
    "decided_by" BIGINT,
    "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_job_assignments" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_milestones" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "job_id" BIGINT NOT NULL,
    "factory_id" BIGINT NOT NULL,
    "seq" SMALLINT NOT NULL,
    "step_key" TEXT NOT NULL,
    "evidence" "evidence_requirement" NOT NULL DEFAULT 'none',
    "tracks_quantity" BOOLEAN NOT NULL DEFAULT false,
    "customer_visible" BOOLEAN NOT NULL DEFAULT false,
    "status" "milestone_status" NOT NULL DEFAULT 'pending',
    "due_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "quantity_in" INTEGER,
    "quantity_out" INTEGER,
    "quantity_scrap" INTEGER,
    "reported_by" BIGINT,
    "reported_by_client_id" BIGINT,
    "client_ref" UUID,
    "client_reported_at" TIMESTAMPTZ(6),
    "on_time" BOOLEAN,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_job_milestones" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_checks" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "job_id" BIGINT NOT NULL,
    "factory_id" BIGINT NOT NULL,
    "checklist_version" TEXT NOT NULL,
    "checklist" JSONB NOT NULL,
    "result" "qc_result" NOT NULL,
    "is_first_pass" BOOLEAN NOT NULL,
    "defects" JSONB NOT NULL DEFAULT '[]',
    "quantity_checked" INTEGER,
    "quantity_defective" INTEGER,
    "note" TEXT,
    "performed_by" BIGINT,
    "performed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_qc_checks" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspections" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "job_id" BIGINT NOT NULL,
    "reasons" "inspection_reason"[],
    "sampling_refs" JSONB NOT NULL,
    "rate_pct" DECIMAL(7,4) NOT NULL,
    "selected" BOOLEAN NOT NULL,
    "lot_size" INTEGER NOT NULL,
    "sample_size" INTEGER NOT NULL,
    "aql_critical" DECIMAL(5,2) NOT NULL,
    "aql_major" DECIMAL(5,2) NOT NULL,
    "aql_minor" DECIMAL(5,2) NOT NULL,
    "accept_critical" INTEGER NOT NULL,
    "accept_major" INTEGER NOT NULL,
    "accept_minor" INTEGER NOT NULL,
    "found_critical" INTEGER,
    "found_major" INTEGER,
    "found_minor" INTEGER,
    "inspector_user_id" BIGINT,
    "scheduled_at" TIMESTAMPTZ(6),
    "status" "inspection_status" NOT NULL DEFAULT 'planned',
    "result_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_inspections" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_issues" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "job_id" BIGINT NOT NULL,
    "factory_id" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "raised_by" BIGINT,
    "status" "issue_status" NOT NULL DEFAULT 'open',
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" BIGINT,
    "resolution_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_job_issues" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_scorecards" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "factory_id" BIGINT NOT NULL,
    "month" DATE NOT NULL,
    "on_time_acceptance_pct" DECIMAL(7,4),
    "on_time_shipping_pct" DECIMAL(7,4),
    "qc_first_pass_pct" DECIMAL(7,4),
    "claim_rate_pct" DECIMAL(7,4),
    "on_time_updates_pct" DECIMAL(7,4),
    "jobs_count" INTEGER NOT NULL,
    "inputs" JSONB NOT NULL,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_factory_scorecards" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_milestone_routes__public_id" ON "milestone_routes"("public_id");

-- CreateIndex
CREATE INDEX "ix_milestone_routes__product_type_id" ON "milestone_routes"("product_type_id");

-- CreateIndex
CREATE INDEX "ix_milestone_routes__print_type_id" ON "milestone_routes"("print_type_id");

-- CreateIndex
CREATE INDEX "ix_milestone_routes__created_by" ON "milestone_routes"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_milestone_route_versions__public_id" ON "milestone_route_versions"("public_id");

-- CreateIndex
CREATE INDEX "ix_milestone_route_versions__resolution" ON "milestone_route_versions"("route_id", "effective_from" DESC, "version_no" DESC) WHERE (status = 'approved'::config_version_status);

-- CreateIndex
CREATE INDEX "ix_milestone_route_versions__approval_request_id" ON "milestone_route_versions"("approval_request_id");

-- CreateIndex
CREATE INDEX "ix_milestone_route_versions__created_by" ON "milestone_route_versions"("created_by");

-- CreateIndex
CREATE INDEX "ix_milestone_route_versions__decided_by" ON "milestone_route_versions"("decided_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_milestone_route_versions__route_id__version_no" ON "milestone_route_versions"("route_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_milestone_route_steps__version_id__seq" ON "milestone_route_steps"("version_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ux_milestone_route_steps__version_id__key" ON "milestone_route_steps"("version_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ux_production_jobs__public_id" ON "production_jobs"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_production_jobs__job_no" ON "production_jobs"("job_no");

-- CreateIndex
CREATE INDEX "ix_production_jobs__order_id" ON "production_jobs"("order_id");

-- CreateIndex
CREATE INDEX "ix_production_jobs__factory_id__status" ON "production_jobs"("factory_id", "status");

-- CreateIndex
CREATE INDEX "ix_production_jobs__status__accept_due_at" ON "production_jobs"("status", "accept_due_at");

-- CreateIndex
CREATE INDEX "ix_production_jobs__factory_id__promised_ship_date" ON "production_jobs"("factory_id", "promised_ship_date");

-- CreateIndex
CREATE INDEX "ix_production_jobs__entity_id" ON "production_jobs"("entity_id");

-- CreateIndex
CREATE INDEX "ix_production_jobs__reproduction_of_job_id" ON "production_jobs"("reproduction_of_job_id");

-- CreateIndex
CREATE INDEX "ix_production_jobs__claim_id" ON "production_jobs"("claim_id");

-- CreateIndex
CREATE INDEX "ix_production_jobs__purchase_order_id" ON "production_jobs"("purchase_order_id");

-- CreateIndex
CREATE INDEX "ix_production_jobs__order_line_id" ON "production_jobs"("order_line_id");

-- CreateIndex
CREATE INDEX "ix_production_jobs__released_by" ON "production_jobs"("released_by");

-- CreateIndex
CREATE INDEX "ix_production_jobs__accepted_by" ON "production_jobs"("accepted_by");

-- CreateIndex
CREATE INDEX "ix_production_jobs__rejected_by" ON "production_jobs"("rejected_by");

-- CreateIndex
CREATE INDEX "ix_production_jobs__updated_by" ON "production_jobs"("updated_by");

-- CreateIndex
CREATE INDEX "ix_production_jobs__route_version_id" ON "production_jobs"("route_version_id");

-- CreateIndex
CREATE INDEX "ix_production_jobs__price_list_version_id" ON "production_jobs"("price_list_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_production_jobs__one_live_production" ON "production_jobs"("order_id") WHERE ((job_kind = 'production'::job_kind) AND (status <> ALL (ARRAY['rejected'::production_job_status, 'cancelled'::production_job_status])));

-- CreateIndex
CREATE UNIQUE INDEX "ux_production_jobs__one_live_mockup" ON "production_jobs"("order_id") WHERE ((job_kind = 'mockup'::job_kind) AND (status <> ALL (ARRAY['rejected'::production_job_status, 'cancelled'::production_job_status])));

-- CreateIndex
CREATE INDEX "ix_job_assignments__job_id" ON "job_assignments"("job_id");

-- CreateIndex
CREATE INDEX "ix_job_assignments__from_factory_id" ON "job_assignments"("from_factory_id");

-- CreateIndex
CREATE INDEX "ix_job_assignments__to_factory_id" ON "job_assignments"("to_factory_id");

-- CreateIndex
CREATE INDEX "ix_job_assignments__decided_by" ON "job_assignments"("decided_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_job_milestones__public_id" ON "job_milestones"("public_id");

-- CreateIndex
CREATE INDEX "ix_job_milestones__factory_id__status" ON "job_milestones"("factory_id", "status");

-- CreateIndex
CREATE INDEX "ix_job_milestones__reported_by" ON "job_milestones"("reported_by");

-- CreateIndex
CREATE INDEX "ix_job_milestones__reported_by_client_id" ON "job_milestones"("reported_by_client_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_job_milestones__job_id__seq" ON "job_milestones"("job_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ux_job_milestones__job_id__client_ref" ON "job_milestones"("job_id", "client_ref") WHERE (client_ref IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "ux_qc_checks__public_id" ON "qc_checks"("public_id");

-- CreateIndex
CREATE INDEX "ix_qc_checks__job_id__performed_at" ON "qc_checks"("job_id", "performed_at");

-- CreateIndex
CREATE INDEX "ix_qc_checks__factory_id__performed_at" ON "qc_checks"("factory_id", "performed_at");

-- CreateIndex
CREATE INDEX "ix_qc_checks__performed_by" ON "qc_checks"("performed_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_inspections__public_id" ON "inspections"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_inspections__job_id" ON "inspections"("job_id");

-- CreateIndex
CREATE INDEX "ix_inspections__status__scheduled_at" ON "inspections"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "ix_inspections__inspector_user_id" ON "inspections"("inspector_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_job_issues__public_id" ON "job_issues"("public_id");

-- CreateIndex
CREATE INDEX "ix_job_issues__job_id" ON "job_issues"("job_id");

-- CreateIndex
CREATE INDEX "ix_job_issues__factory_id__status" ON "job_issues"("factory_id", "status");

-- CreateIndex
CREATE INDEX "ix_job_issues__raised_by" ON "job_issues"("raised_by");

-- CreateIndex
CREATE INDEX "ix_job_issues__resolved_by" ON "job_issues"("resolved_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_factory_scorecards__factory_id__month" ON "factory_scorecards"("factory_id", "month");

-- AddForeignKey
ALTER TABLE "milestone_routes" ADD CONSTRAINT "fk_milestone_routes__product_type_id" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "milestone_routes" ADD CONSTRAINT "fk_milestone_routes__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "milestone_routes" ADD CONSTRAINT "fk_milestone_routes__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "milestone_route_versions" ADD CONSTRAINT "fk_milestone_route_versions__route_id" FOREIGN KEY ("route_id") REFERENCES "milestone_routes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "milestone_route_versions" ADD CONSTRAINT "fk_milestone_route_versions__approval_request_id" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "milestone_route_versions" ADD CONSTRAINT "fk_milestone_route_versions__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "milestone_route_versions" ADD CONSTRAINT "fk_milestone_route_versions__decided_by" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "milestone_route_steps" ADD CONSTRAINT "fk_milestone_route_steps__version_id" FOREIGN KEY ("version_id") REFERENCES "milestone_route_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "fk_production_jobs__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "fk_production_jobs__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "fk_production_jobs__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "fk_production_jobs__reproduction_of_job_id" FOREIGN KEY ("reproduction_of_job_id") REFERENCES "production_jobs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "fk_production_jobs__order_line_id" FOREIGN KEY ("order_line_id") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "fk_production_jobs__released_by" FOREIGN KEY ("released_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "fk_production_jobs__accepted_by" FOREIGN KEY ("accepted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "fk_production_jobs__rejected_by" FOREIGN KEY ("rejected_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "fk_production_jobs__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "fk_production_jobs__route_version_id" FOREIGN KEY ("route_version_id") REFERENCES "milestone_route_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "fk_production_jobs__price_list_version_id" FOREIGN KEY ("price_list_version_id") REFERENCES "price_list_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "job_assignments" ADD CONSTRAINT "fk_job_assignments__job_id" FOREIGN KEY ("job_id") REFERENCES "production_jobs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "job_assignments" ADD CONSTRAINT "fk_job_assignments__from_factory_id" FOREIGN KEY ("from_factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "job_assignments" ADD CONSTRAINT "fk_job_assignments__to_factory_id" FOREIGN KEY ("to_factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "job_assignments" ADD CONSTRAINT "fk_job_assignments__decided_by" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "job_milestones" ADD CONSTRAINT "fk_job_milestones__job_id" FOREIGN KEY ("job_id") REFERENCES "production_jobs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "job_milestones" ADD CONSTRAINT "fk_job_milestones__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "job_milestones" ADD CONSTRAINT "fk_job_milestones__reported_by" FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "job_milestones" ADD CONSTRAINT "fk_job_milestones__reported_by_client_id" FOREIGN KEY ("reported_by_client_id") REFERENCES "api_clients"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "qc_checks" ADD CONSTRAINT "fk_qc_checks__job_id" FOREIGN KEY ("job_id") REFERENCES "production_jobs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "qc_checks" ADD CONSTRAINT "fk_qc_checks__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "qc_checks" ADD CONSTRAINT "fk_qc_checks__performed_by" FOREIGN KEY ("performed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "fk_inspections__job_id" FOREIGN KEY ("job_id") REFERENCES "production_jobs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "fk_inspections__inspector_user_id" FOREIGN KEY ("inspector_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "job_issues" ADD CONSTRAINT "fk_job_issues__job_id" FOREIGN KEY ("job_id") REFERENCES "production_jobs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "job_issues" ADD CONSTRAINT "fk_job_issues__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "job_issues" ADD CONSTRAINT "fk_job_issues__raised_by" FOREIGN KEY ("raised_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "job_issues" ADD CONSTRAINT "fk_job_issues__resolved_by" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "factory_scorecards" ADD CONSTRAINT "fk_factory_scorecards__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "capacity_bookings" ADD CONSTRAINT "fk_capacity_bookings__production_job_id" FOREIGN KEY ("production_job_id") REFERENCES "production_jobs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- =====================================================================================================
-- Hand-written: milestone routes, production jobs, milestones, QC, inspections, issues, scorecards
-- (D-073…D-076, D-012, D-101, D-155; schema-design §3.7, A-37)
-- =====================================================================================================
CREATE UNIQUE INDEX ux_milestone_routes__type__print__variant
  ON milestone_routes (product_type_id, coalesce(print_type_id, 0), variant);
ALTER TABLE milestone_routes
  ADD CONSTRAINT ck_milestone_routes__variant CHECK (variant ~ '^[a-z][a-z0-9_]*$'),
  ADD CONSTRAINT ck_milestone_routes__name CHECK (btrim(name) <> '');

ALTER TABLE milestone_route_versions
  ADD CONSTRAINT ck_milestone_route_versions__version_no CHECK (version_no > 0),
  ADD CONSTRAINT ck_milestone_route_versions__reason CHECK (btrim(reason) <> ''),
  ADD CONSTRAINT ck_milestone_route_versions__decided CHECK (
    status NOT IN ('approved', 'rejected', 'withdrawn') OR decided_at IS NOT NULL),
  ADD CONSTRAINT ck_milestone_route_versions__no_acceptance CHECK (status <> 'pending_acceptance');
CREATE TRIGGER tg_milestone_route_versions__frozen BEFORE UPDATE OR DELETE ON milestone_route_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_version_change();

ALTER TABLE milestone_route_steps
  ADD CONSTRAINT ck_milestone_route_steps__seq CHECK (seq > 0),
  ADD CONSTRAINT ck_milestone_route_steps__key CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  ADD CONSTRAINT ck_milestone_route_steps__names CHECK (btrim(name_th) <> '' AND btrim(name_en) <> ''),
  ADD CONSTRAINT ck_milestone_route_steps__label CHECK (NOT customer_visible OR (customer_label_th IS NOT NULL AND customer_label_en IS NOT NULL)),
  ADD CONSTRAINT ck_milestone_route_steps__share CHECK (planned_share_pct IS NULL OR (planned_share_pct > 0 AND planned_share_pct <= 100));
-- Steps are part of their version: written while it is a draft, frozen once proposed or decided.
CREATE FUNCTION forbid_decided_route_step_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  version_status config_version_status;
BEGIN
  SELECT status INTO version_status FROM milestone_route_versions
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
  IF version_status IS NOT NULL AND version_status <> 'draft' THEN
    RAISE EXCEPTION 'steps of a % milestone route version cannot be changed', version_status
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER tg_milestone_route_steps__draft_only BEFORE INSERT OR UPDATE OR DELETE ON milestone_route_steps
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_route_step_change();

ALTER TABLE production_jobs
  ADD CONSTRAINT ck_production_jobs__job_no CHECK (btrim(job_no) <> ''),
  ADD CONSTRAINT ck_production_jobs__quantities CHECK (
    quantity_ordered > 0 AND (quantity_good IS NULL OR quantity_good >= 0) AND (quantity_scrap IS NULL OR quantity_scrap >= 0)),
  ADD CONSTRAINT ck_production_jobs__tolerance CHECK (
    (tolerance_shortage_pct IS NULL OR tolerance_shortage_pct BETWEEN 0 AND 100)
    AND (tolerance_overage_pct IS NULL OR tolerance_overage_pct BETWEEN 0 AND 100)),
  ADD CONSTRAINT ck_production_jobs__manual_reason CHECK (
    release_mode <> 'manual_exception' OR (release_reason IS NOT NULL AND btrim(release_reason) <> '' AND released_by IS NOT NULL)),
  ADD CONSTRAINT ck_production_jobs__reproduction CHECK ((job_kind = 'reproduction') = (reproduction_of_job_id IS NOT NULL)),
  ADD CONSTRAINT ck_production_jobs__mockup_line CHECK (job_kind <> 'mockup' OR order_line_id IS NOT NULL),
  ADD CONSTRAINT ck_production_jobs__accepted CHECK (
    status NOT IN ('accepted', 'in_progress', 'on_hold', 'completed') OR accepted_at IS NOT NULL),
  ADD CONSTRAINT ck_production_jobs__rejected CHECK (
    status <> 'rejected' OR (rejected_at IS NOT NULL AND reject_reason_code IS NOT NULL)),
  ADD CONSTRAINT ck_production_jobs__completed CHECK (status <> 'completed' OR actual_finish_at IS NOT NULL),
  ADD CONSTRAINT ck_production_jobs__on_hold CHECK (status <> 'on_hold' OR hold_reason IS NOT NULL),
  ADD CONSTRAINT ck_production_jobs__cancelled CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL),
  ADD CONSTRAINT ck_production_jobs__not_self CHECK (reproduction_of_job_id IS DISTINCT FROM id);
-- What the factory was asked to make, at which price and along which route, is write-once (§2.2).
CREATE FUNCTION tg_production_jobs__snapshot_write_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'production jobs are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.job_no <> OLD.job_no OR NEW.entity_id <> OLD.entity_id OR NEW.order_id <> OLD.order_id
     OR NEW.factory_id <> OLD.factory_id OR NEW.job_kind <> OLD.job_kind
     OR NEW.reproduction_of_job_id IS DISTINCT FROM OLD.reproduction_of_job_id
     OR NEW.quantity_ordered <> OLD.quantity_ordered
     OR NEW.spec_snapshot <> OLD.spec_snapshot OR NEW.route_version_id <> OLD.route_version_id
     OR NEW.route_snapshot <> OLD.route_snapshot
     OR NEW.price_list_version_id IS DISTINCT FROM OLD.price_list_version_id
     OR NEW.buy_price_snapshot <> OLD.buy_price_snapshot
     OR NEW.tolerance_shortage_pct IS DISTINCT FROM OLD.tolerance_shortage_pct
     OR NEW.tolerance_overage_pct IS DISTINCT FROM OLD.tolerance_overage_pct
     OR NEW.released_at <> OLD.released_at OR NEW.release_mode <> OLD.release_mode THEN
    RAISE EXCEPTION 'production job % snapshot is write-once', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_production_jobs__snapshot_write_once BEFORE UPDATE OR DELETE ON production_jobs
  FOR EACH ROW EXECUTE FUNCTION tg_production_jobs__snapshot_write_once();

ALTER TABLE job_assignments
  ADD CONSTRAINT ck_job_assignments__factories CHECK (from_factory_id IS DISTINCT FROM to_factory_id OR to_factory_id IS NULL),
  ADD CONSTRAINT ck_job_assignments__escalated CHECK (mode <> 'escalated' OR to_factory_id IS NULL);
CREATE TRIGGER tg_job_assignments__append_only BEFORE UPDATE OR DELETE ON job_assignments
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_row_change();

ALTER TABLE job_milestones
  ADD CONSTRAINT ck_job_milestones__seq CHECK (seq > 0),
  ADD CONSTRAINT ck_job_milestones__quantities CHECK (
    (quantity_in IS NULL OR quantity_in >= 0) AND (quantity_out IS NULL OR quantity_out >= 0)
    AND (quantity_scrap IS NULL OR quantity_scrap >= 0)),
  ADD CONSTRAINT ck_job_milestones__started CHECK (status NOT IN ('in_progress', 'completed') OR started_at IS NOT NULL),
  ADD CONSTRAINT ck_job_milestones__completed CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  ADD CONSTRAINT ck_job_milestones__reporter CHECK (num_nonnulls(reported_by, reported_by_client_id) <= 1);
CREATE TRIGGER tg_job_milestones__no_delete BEFORE DELETE ON job_milestones
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE qc_checks
  ADD CONSTRAINT ck_qc_checks__version CHECK (btrim(checklist_version) <> ''),
  ADD CONSTRAINT ck_qc_checks__quantities CHECK (
    (quantity_checked IS NULL OR quantity_checked >= 0) AND (quantity_defective IS NULL OR quantity_defective >= 0)
    AND (quantity_checked IS NULL OR quantity_defective IS NULL OR quantity_defective <= quantity_checked));
CREATE TRIGGER tg_qc_checks__append_only BEFORE UPDATE OR DELETE ON qc_checks
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_row_change();

ALTER TABLE inspections
  ADD CONSTRAINT ck_inspections__sample CHECK (lot_size > 0 AND sample_size > 0 AND sample_size <= lot_size),
  ADD CONSTRAINT ck_inspections__rate CHECK (rate_pct BETWEEN 0 AND 100),
  ADD CONSTRAINT ck_inspections__aql CHECK (aql_critical >= 0 AND aql_major >= 0 AND aql_minor >= 0),
  ADD CONSTRAINT ck_inspections__accept CHECK (accept_critical >= 0 AND accept_major >= 0 AND accept_minor >= 0),
  ADD CONSTRAINT ck_inspections__found CHECK (
    (found_critical IS NULL OR found_critical >= 0) AND (found_major IS NULL OR found_major >= 0)
    AND (found_minor IS NULL OR found_minor >= 0)),
  ADD CONSTRAINT ck_inspections__result CHECK (status NOT IN ('passed', 'failed') OR (result_at IS NOT NULL AND found_critical IS NOT NULL AND found_major IS NOT NULL AND found_minor IS NOT NULL)),
  ADD CONSTRAINT ck_inspections__waived CHECK (status <> 'waived' OR notes IS NOT NULL);
CREATE TRIGGER tg_inspections__no_delete BEFORE DELETE ON inspections
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE job_issues
  ADD CONSTRAINT ck_job_issues__text CHECK (btrim(kind) <> '' AND btrim(description) <> ''),
  ADD CONSTRAINT ck_job_issues__resolved CHECK ((status = 'resolved') = (resolved_at IS NOT NULL));
CREATE TRIGGER tg_job_issues__no_delete BEFORE DELETE ON job_issues
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE factory_scorecards
  ADD CONSTRAINT ck_factory_scorecards__month CHECK (extract(day FROM month) = 1),
  ADD CONSTRAINT ck_factory_scorecards__jobs CHECK (jobs_count >= 0),
  ADD CONSTRAINT ck_factory_scorecards__pcts CHECK (
    (on_time_acceptance_pct IS NULL OR on_time_acceptance_pct BETWEEN 0 AND 100)
    AND (on_time_shipping_pct IS NULL OR on_time_shipping_pct BETWEEN 0 AND 100)
    AND (qc_first_pass_pct IS NULL OR qc_first_pass_pct BETWEEN 0 AND 100)
    AND (claim_rate_pct IS NULL OR claim_rate_pct BETWEEN 0 AND 100)
    AND (on_time_updates_pct IS NULL OR on_time_updates_pct BETWEEN 0 AND 100));
