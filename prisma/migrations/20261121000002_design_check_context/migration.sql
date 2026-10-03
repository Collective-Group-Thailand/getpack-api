-- U4.B5 (schema-design A-99; D-278, D-282): a check run is keyed by what its evaluation depended on besides the
-- document and the catalogue — the studio elements lacking a declared right — so a new declaration re-evaluates.
-- DropIndex
DROP INDEX "ux_design_check_runs__version__rules__source";

-- AlterTable
ALTER TABLE "design_check_runs" ADD COLUMN     "context_key" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "ux_design_check_runs__version__rules__source__context" ON "design_check_runs"("version_id", "rules_version_id", "source", "context_key");


ALTER TABLE design_check_runs
  ADD CONSTRAINT ck_design_check_runs__context_key CHECK (context_key ~ '^[0-9a-f]{0,64}$');
