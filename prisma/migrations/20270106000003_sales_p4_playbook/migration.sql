-- D-470 (agent portal pack, Phase 4; PLAN A-13): the playbook cards get an owner role and maker-checker publishing
-- (submitted by / at, published by, change note). The rep / manager-only cards are owned by the Sales Manager.
-- Non-destructive. Rollback: down.sql.
-- AlterTable
ALTER TABLE "sales_playbook_cards" ADD COLUMN     "change_note" TEXT,
ADD COLUMN     "owner_role" VARCHAR(32) NOT NULL DEFAULT 'marketing',
ADD COLUMN     "published_by" BIGINT,
ADD COLUMN     "submitted_at" TIMESTAMPTZ(6),
ADD COLUMN     "submitted_by" BIGINT;


-- CreateCheck
ALTER TABLE "sales_playbook_cards" ADD CONSTRAINT "ck_sales_playbook_cards__owner_role"
  CHECK (owner_role IN ('marketing', 'sales_manager'));

-- Data: the cards written for reps and managers only belong to the Sales Manager.
UPDATE "sales_playbook_cards" SET "owner_role" = 'sales_manager'
 WHERE NOT ('agent' = ANY ("audiences"));
