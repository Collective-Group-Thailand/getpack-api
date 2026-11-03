-- D-472 (agent portal pack, Phase 6; PLAN A-14): the management P&L planner — plans by fiscal year and scenario,
-- their cells (auto / calculated / manual / override with the auto value kept beside an override), Finance's notes
-- on plan-vs-actual variances and the append-only access log of views and exports. Management figures only: no
-- table here is read by the ledger and nothing is posted. A locked plan and its cells never change (triggers).
-- Non-destructive. Rollback: down.sql.
-- CreateEnum
CREATE TYPE "pnl_scenario" AS ENUM ('base', 'best', 'worst', 'custom');

-- CreateEnum
CREATE TYPE "pnl_plan_status" AS ENUM ('draft', 'locked');

-- CreateEnum
CREATE TYPE "pnl_cell_mode" AS ENUM ('auto', 'calculated', 'manual', 'override');

-- CreateEnum
CREATE TYPE "pnl_cell_source" AS ENUM ('gl', 'pipeline_run_rate', 'trailing_ratio', 'trailing_average', 'commission_rates', 'fixed_assets', 'balances', 'formula', 'none');

-- CreateEnum
CREATE TYPE "pnl_access_purpose" AS ENUM ('view', 'variance', 'export');

-- CreateTable
CREATE TABLE "pnl_plans" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "fiscal_year" SMALLINT NOT NULL,
    "scenario" "pnl_scenario" NOT NULL,
    "status" "pnl_plan_status" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "owner_user_id" BIGINT NOT NULL,
    "copied_from_plan_id" BIGINT,
    "computed_at" TIMESTAMPTZ(6),
    "catalogue_version_id" BIGINT,
    "forecast_rules_version_id" BIGINT,
    "cit_rates_version_id" BIGINT,
    "locked_at" TIMESTAMPTZ(6),
    "locked_by" BIGINT,
    "snapshot_sha256" BYTEA,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_pnl_plans" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pnl_plan_cells" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "plan_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "value" DECIMAL(14,2),
    "mode" "pnl_cell_mode" NOT NULL,
    "auto_value" DECIMAL(14,2),
    "source" "pnl_cell_source" NOT NULL DEFAULT 'none',
    "source_ref" JSONB,
    "note" TEXT,
    "period_open" BOOLEAN NOT NULL DEFAULT false,
    "as_of" TIMESTAMPTZ(6),
    "updated_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_pnl_plan_cells" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pnl_variance_notes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "plan_id" BIGINT NOT NULL,
    "line_key" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "note" TEXT NOT NULL,
    "updated_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_pnl_variance_notes" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pnl_access_logs" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "plan_id" BIGINT NOT NULL,
    "viewer_user_id" BIGINT NOT NULL,
    "purpose" "pnl_access_purpose" NOT NULL,
    "format" TEXT,
    "request_id" TEXT,
    "viewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pnl_access_logs" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_pnl_plans__public_id" ON "pnl_plans"("public_id");

-- CreateIndex
CREATE INDEX "ix_pnl_plans__entity_id__fiscal_year" ON "pnl_plans"("entity_id", "fiscal_year");

-- CreateIndex
CREATE INDEX "ix_pnl_plans__owner_user_id" ON "pnl_plans"("owner_user_id");

-- CreateIndex
CREATE INDEX "ix_pnl_plans__locked_by" ON "pnl_plans"("locked_by");

-- CreateIndex
CREATE INDEX "ix_pnl_plans__created_by" ON "pnl_plans"("created_by");

-- CreateIndex
CREATE INDEX "ix_pnl_plans__copied_from_plan_id" ON "pnl_plans"("copied_from_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pnl_plans__entity_id__fiscal_year__scenario__name__version" ON "pnl_plans"("entity_id", "fiscal_year", "scenario", "name", "version") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "ux_pnl_plan_cells__public_id" ON "pnl_plan_cells"("public_id");

-- CreateIndex
CREATE INDEX "ix_pnl_plan_cells__updated_by" ON "pnl_plan_cells"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pnl_plan_cells__plan_id__line_key__month" ON "pnl_plan_cells"("plan_id", "line_key", "month");

-- CreateIndex
CREATE INDEX "ix_pnl_variance_notes__updated_by" ON "pnl_variance_notes"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pnl_variance_notes__plan_id__line_key__month" ON "pnl_variance_notes"("plan_id", "line_key", "month");

-- CreateIndex
CREATE UNIQUE INDEX "ux_pnl_access_logs__public_id" ON "pnl_access_logs"("public_id");

-- CreateIndex
CREATE INDEX "ix_pnl_access_logs__plan_id__viewed_at" ON "pnl_access_logs"("plan_id", "viewed_at");

-- CreateIndex
CREATE INDEX "ix_pnl_access_logs__viewer_user_id__viewed_at" ON "pnl_access_logs"("viewer_user_id", "viewed_at");

-- AddForeignKey
ALTER TABLE "pnl_plans" ADD CONSTRAINT "fk_pnl_plans__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pnl_plans" ADD CONSTRAINT "fk_pnl_plans__owner_user_id" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pnl_plans" ADD CONSTRAINT "fk_pnl_plans__locked_by" FOREIGN KEY ("locked_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pnl_plans" ADD CONSTRAINT "fk_pnl_plans__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pnl_plans" ADD CONSTRAINT "fk_pnl_plans__copied_from_plan_id" FOREIGN KEY ("copied_from_plan_id") REFERENCES "pnl_plans"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pnl_plan_cells" ADD CONSTRAINT "fk_pnl_plan_cells__plan_id" FOREIGN KEY ("plan_id") REFERENCES "pnl_plans"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pnl_plan_cells" ADD CONSTRAINT "fk_pnl_plan_cells__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pnl_variance_notes" ADD CONSTRAINT "fk_pnl_variance_notes__plan_id" FOREIGN KEY ("plan_id") REFERENCES "pnl_plans"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pnl_variance_notes" ADD CONSTRAINT "fk_pnl_variance_notes__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pnl_access_logs" ADD CONSTRAINT "fk_pnl_access_logs__plan_id" FOREIGN KEY ("plan_id") REFERENCES "pnl_plans"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "pnl_access_logs" ADD CONSTRAINT "fk_pnl_access_logs__viewer_user_id" FOREIGN KEY ("viewer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- D-472: a cell month is the first day of a month; a plan year is a sensible calendar year.
ALTER TABLE "pnl_plan_cells" ADD CONSTRAINT "ck_pnl_plan_cells__month_first_day" CHECK (EXTRACT(DAY FROM "month") = 1);
ALTER TABLE "pnl_variance_notes" ADD CONSTRAINT "ck_pnl_variance_notes__month_first_day" CHECK (EXTRACT(DAY FROM "month") = 1);
ALTER TABLE "pnl_plans" ADD CONSTRAINT "ck_pnl_plans__fiscal_year" CHECK ("fiscal_year" BETWEEN 2000 AND 2200);
ALTER TABLE "pnl_plans" ADD CONSTRAINT "ck_pnl_plans__version" CHECK ("version" >= 1);
ALTER TABLE "pnl_plans" ADD CONSTRAINT "ck_pnl_plans__locked" CHECK (
  ("status" = 'locked') = ("locked_at" IS NOT NULL AND "snapshot_sha256" IS NOT NULL)
);
ALTER TABLE "pnl_plans" ADD CONSTRAINT "ck_pnl_plans__deleted_draft" CHECK ("deleted_at" IS NULL OR "status" = 'draft');

-- D-472: locking is final — a locked plan row is never updated or deleted, and no cell of a locked plan is inserted,
-- updated or deleted (plan vs actual compares against this frozen snapshot; a revision is a copy).
CREATE FUNCTION pnl_forbid_locked_plan_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'locked' THEN
    RAISE EXCEPTION 'pnl plan % is locked', OLD.public_id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tg_pnl_plans__locked BEFORE UPDATE OR DELETE ON pnl_plans
  FOR EACH ROW EXECUTE FUNCTION pnl_forbid_locked_plan_change();

CREATE FUNCTION pnl_forbid_locked_cell_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  locked boolean;
BEGIN
  SELECT p.status = 'locked' INTO locked FROM pnl_plans p
   WHERE p.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.plan_id ELSE NEW.plan_id END;
  IF locked OR (TG_OP = 'UPDATE' AND OLD.plan_id <> NEW.plan_id) THEN
    RAISE EXCEPTION 'cells of a locked pnl plan cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tg_pnl_plan_cells__locked BEFORE INSERT OR UPDATE OR DELETE ON pnl_plan_cells
  FOR EACH ROW EXECUTE FUNCTION pnl_forbid_locked_cell_change();

CREATE TRIGGER tg_pnl_access_logs__append_only BEFORE UPDATE OR DELETE ON pnl_access_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
