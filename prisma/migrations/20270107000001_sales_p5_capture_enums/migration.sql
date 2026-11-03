-- D-471 (agent portal pack, Phase 5): the new inbound sources (studio design not ordered, dieline download) and the
-- assignment mode `attribution` (the rep a contact is already attributed to). Own migration: a new enum value cannot
-- be used in the transaction that adds it. Non-destructive. Rollback: down.sql.
-- AlterEnum
ALTER TYPE "sales_inbound_assignment_mode" ADD VALUE 'attribution';

-- AlterEnum
ALTER TYPE "sales_inbound_source" ADD VALUE 'studio_idle';
ALTER TYPE "sales_inbound_source" ADD VALUE 'dieline_download';
