-- U3.B3 (schema-design A-88; D-244, D-041): the process taxonomy, factory process capabilities per material class
-- (proposed by the factory or the Partner team, verified by the Partner Manager against a passing site visit) and the
-- style process rules (which processes a style needs when its recipe declares none).

-- CreateEnum
CREATE TYPE "process_capability_status" AS ENUM ('proposed', 'verified', 'rejected', 'withdrawn', 'superseded');

-- CreateEnum
CREATE TYPE "style_process_scope" AS ENUM ('source_product_type', 'category', 'family', 'option');

-- CreateTable
CREATE TABLE "process_types" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_process_types" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_process_capabilities" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "process_type_id" BIGINT NOT NULL,
    "material_class" TEXT NOT NULL,
    "min_blank_w_mm" DECIMAL(10,2),
    "min_blank_l_mm" DECIMAL(10,2),
    "max_blank_w_mm" DECIMAL(10,2),
    "max_blank_l_mm" DECIMAL(10,2),
    "max_caliper_mm" DECIMAL(6,3),
    "min_run" INTEGER,
    "lead_time_min_days" SMALLINT NOT NULL,
    "lead_time_max_days" SMALLINT NOT NULL,
    "status" "process_capability_status" NOT NULL DEFAULT 'proposed',
    "note" TEXT,
    "proposed_by" BIGINT NOT NULL,
    "proposed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_by" BIGINT,
    "verified_at" TIMESTAMPTZ(6),
    "site_visit_id" BIGINT,
    "decision_note" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_factory_process_capabilities" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "style_process_rules" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "scope" "style_process_scope" NOT NULL,
    "scope_value" TEXT NOT NULL,
    "process_type_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,

    CONSTRAINT "pk_style_process_rules" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_process_types__public_id" ON "process_types"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_process_types__code" ON "process_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ux_factory_process_capabilities__public_id" ON "factory_process_capabilities"("public_id");

-- CreateIndex
CREATE INDEX "ix_factory_process_capabilities__factory_id__status" ON "factory_process_capabilities"("factory_id", "status");

-- CreateIndex
CREATE INDEX "ix_factory_process_capabilities__process__material" ON "factory_process_capabilities"("process_type_id", "material_class");

-- CreateIndex
CREATE INDEX "ix_factory_process_capabilities__proposed_by" ON "factory_process_capabilities"("proposed_by");

-- CreateIndex
CREATE INDEX "ix_factory_process_capabilities__verified_by" ON "factory_process_capabilities"("verified_by");

-- CreateIndex
CREATE INDEX "ix_factory_process_capabilities__site_visit_id" ON "factory_process_capabilities"("site_visit_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_factory_process_capabilities__verified" ON "factory_process_capabilities"("factory_id", "process_type_id", "material_class") WHERE (status = 'verified'::process_capability_status);

-- CreateIndex
CREATE UNIQUE INDEX "ux_style_process_rules__public_id" ON "style_process_rules"("public_id");

-- CreateIndex
CREATE INDEX "ix_style_process_rules__process_type_id" ON "style_process_rules"("process_type_id");

-- CreateIndex
CREATE INDEX "ix_style_process_rules__created_by" ON "style_process_rules"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_style_process_rules__scope__value__process" ON "style_process_rules"("scope", "scope_value", "process_type_id");

-- AddForeignKey
ALTER TABLE "factory_process_capabilities" ADD CONSTRAINT "fk_factory_process_capabilities__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "factory_process_capabilities" ADD CONSTRAINT "fk_factory_process_capabilities__process_type_id" FOREIGN KEY ("process_type_id") REFERENCES "process_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "factory_process_capabilities" ADD CONSTRAINT "fk_factory_process_capabilities__proposed_by" FOREIGN KEY ("proposed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "factory_process_capabilities" ADD CONSTRAINT "fk_factory_process_capabilities__verified_by" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "factory_process_capabilities" ADD CONSTRAINT "fk_factory_process_capabilities__site_visit_id" FOREIGN KEY ("site_visit_id") REFERENCES "site_visits"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_process_rules" ADD CONSTRAINT "fk_style_process_rules__process_type_id" FOREIGN KEY ("process_type_id") REFERENCES "process_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_process_rules" ADD CONSTRAINT "fk_style_process_rules__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- Hand-written (A-88)
ALTER TABLE process_types
  ADD CONSTRAINT ck_process_types__code CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  ADD CONSTRAINT ck_process_types__names CHECK (btrim(name_th) <> '' AND btrim(name_en) <> '');

ALTER TABLE factory_process_capabilities
  ADD CONSTRAINT ck_factory_process_capabilities__material_class CHECK (material_class ~ '^[a-z][a-z0-9_]*$'),
  ADD CONSTRAINT ck_factory_process_capabilities__lead_time CHECK (
    lead_time_min_days >= 0 AND lead_time_max_days >= lead_time_min_days AND lead_time_max_days <= 365),
  ADD CONSTRAINT ck_factory_process_capabilities__blank CHECK (
    (min_blank_w_mm IS NULL OR min_blank_w_mm > 0) AND (min_blank_l_mm IS NULL OR min_blank_l_mm > 0)
    AND (max_blank_w_mm IS NULL OR max_blank_w_mm > 0) AND (max_blank_l_mm IS NULL OR max_blank_l_mm > 0)
    AND (min_blank_w_mm IS NULL OR max_blank_w_mm IS NULL OR min_blank_w_mm <= max_blank_w_mm)
    AND (min_blank_l_mm IS NULL OR max_blank_l_mm IS NULL OR min_blank_l_mm <= max_blank_l_mm)),
  ADD CONSTRAINT ck_factory_process_capabilities__caliper CHECK (max_caliper_mm IS NULL OR max_caliper_mm > 0),
  ADD CONSTRAINT ck_factory_process_capabilities__min_run CHECK (min_run IS NULL OR min_run >= 1),
  ADD CONSTRAINT ck_factory_process_capabilities__verified CHECK (
    status NOT IN ('verified', 'superseded')
    OR (verified_by IS NOT NULL AND verified_at IS NOT NULL AND site_visit_id IS NOT NULL)),
  ADD CONSTRAINT ck_factory_process_capabilities__decided CHECK (
    status NOT IN ('rejected', 'withdrawn', 'superseded') OR decided_at IS NOT NULL);

-- D-244: a decided capability is history; a verified one only becomes superseded or withdrawn. Never deleted.
CREATE FUNCTION tg_factory_process_capabilities__lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'factory process capabilities are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status IN ('rejected', 'withdrawn', 'superseded') THEN
    RAISE EXCEPTION 'process capability % is decided (%)', OLD.id, OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'verified' AND (
       NEW.status NOT IN ('superseded', 'withdrawn')
       OR NEW.factory_id <> OLD.factory_id OR NEW.process_type_id <> OLD.process_type_id
       OR NEW.material_class <> OLD.material_class
       OR NEW.min_blank_w_mm IS DISTINCT FROM OLD.min_blank_w_mm OR NEW.min_blank_l_mm IS DISTINCT FROM OLD.min_blank_l_mm
       OR NEW.max_blank_w_mm IS DISTINCT FROM OLD.max_blank_w_mm OR NEW.max_blank_l_mm IS DISTINCT FROM OLD.max_blank_l_mm
       OR NEW.max_caliper_mm IS DISTINCT FROM OLD.max_caliper_mm OR NEW.min_run IS DISTINCT FROM OLD.min_run
       OR NEW.lead_time_min_days <> OLD.lead_time_min_days OR NEW.lead_time_max_days <> OLD.lead_time_max_days
       OR NEW.verified_by IS DISTINCT FROM OLD.verified_by OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
       OR NEW.site_visit_id IS DISTINCT FROM OLD.site_visit_id) THEN
    RAISE EXCEPTION 'verified process capability % only becomes superseded or withdrawn', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_factory_process_capabilities__lifecycle BEFORE UPDATE OR DELETE ON factory_process_capabilities
  FOR EACH ROW EXECUTE FUNCTION tg_factory_process_capabilities__lifecycle();

ALTER TABLE style_process_rules
  ADD CONSTRAINT ck_style_process_rules__scope_value CHECK (
    (scope = 'option' AND scope_value ~ '^[a-z][a-z0-9_]*:[a-z0-9][a-z0-9_]*$')
    OR (scope <> 'option' AND scope_value ~ '^[a-z][a-z0-9_]*$'));
