-- U4.B3 (schema-design A-97; D-278): studio print-check runs per design version and rules version, their findings
-- (rule ids shared with the web and the PDF preflight) and the customer's acknowledgements of warnings.
-- CreateEnum
CREATE TYPE "design_check_source" AS ENUM ('document', 'pdf');

-- CreateTable
CREATE TABLE "design_check_runs" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "version_id" BIGINT NOT NULL,
    "rules_version_id" BIGINT NOT NULL,
    "source" "design_check_source" NOT NULL,
    "block_count" INTEGER NOT NULL,
    "warn_count" INTEGER NOT NULL,
    "info_count" INTEGER NOT NULL,
    "evaluated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_design_check_runs" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_check_findings" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "run_id" BIGINT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "severity" "preflight_severity" NOT NULL,
    "element_id" TEXT NOT NULL DEFAULT '',
    "details" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "pk_design_check_findings" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_check_acknowledgements" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "version_id" BIGINT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "element_id" TEXT NOT NULL DEFAULT '',
    "user_id" BIGINT NOT NULL,
    "acknowledged_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_design_check_acknowledgements" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_design_check_runs__public_id" ON "design_check_runs"("public_id");

-- CreateIndex
CREATE INDEX "ix_design_check_runs__rules_version_id" ON "design_check_runs"("rules_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_design_check_runs__version__rules__source" ON "design_check_runs"("version_id", "rules_version_id", "source");

-- CreateIndex
CREATE INDEX "ix_design_check_findings__run_id" ON "design_check_findings"("run_id");

-- CreateIndex
CREATE INDEX "ix_design_check_acknowledgements__user_id" ON "design_check_acknowledgements"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_design_check_acknowledgements__version__rule__element" ON "design_check_acknowledgements"("version_id", "rule_id", "element_id");

-- AddForeignKey
ALTER TABLE "design_check_runs" ADD CONSTRAINT "fk_design_check_runs__version_id" FOREIGN KEY ("version_id") REFERENCES "design_document_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_check_runs" ADD CONSTRAINT "fk_design_check_runs__rules_version_id" FOREIGN KEY ("rules_version_id") REFERENCES "setting_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_check_findings" ADD CONSTRAINT "fk_design_check_findings__run_id" FOREIGN KEY ("run_id") REFERENCES "design_check_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_check_acknowledgements" ADD CONSTRAINT "fk_design_check_acknowledgements__version_id" FOREIGN KEY ("version_id") REFERENCES "design_document_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_check_acknowledgements" ADD CONSTRAINT "fk_design_check_acknowledgements__user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- Hand-written checks and triggers (A-97).
ALTER TABLE design_check_runs
  ADD CONSTRAINT ck_design_check_runs__counts CHECK (block_count >= 0 AND warn_count >= 0 AND info_count >= 0);
ALTER TABLE design_check_findings
  ADD CONSTRAINT ck_design_check_findings__rule_id CHECK (rule_id ~ '^[a-z][a-z0-9_]{1,63}$'),
  ADD CONSTRAINT ck_design_check_findings__details CHECK (jsonb_typeof(details) = 'object');
ALTER TABLE design_check_acknowledgements
  ADD CONSTRAINT ck_design_check_acknowledgements__rule_id CHECK (rule_id ~ '^[a-z][a-z0-9_]{1,63}$');
-- A run and its findings are the record of an evaluation; an acknowledgement is evidence: none change or go.
CREATE TRIGGER tg_design_check_runs__write_once BEFORE UPDATE OR DELETE ON design_check_runs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER tg_design_check_findings__write_once BEFORE UPDATE OR DELETE ON design_check_findings
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER tg_design_check_acknowledgements__write_once BEFORE UPDATE OR DELETE ON design_check_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
