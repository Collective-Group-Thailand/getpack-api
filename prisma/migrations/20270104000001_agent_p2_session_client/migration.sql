-- D-467 (agent portal pack, Phase 2): a customer session records the web surface it was opened from, so the agent zone
-- (agent.getpack.co) has its own session families, listed and revoked separately from the storefront. Existing rows
-- become `storefront`. Non-destructive. Rollback: down.sql.
-- CreateEnum
CREATE TYPE "auth_client" AS ENUM ('storefront', 'agent');

-- AlterTable
ALTER TABLE "auth_sessions" ADD COLUMN     "client" "auth_client" NOT NULL DEFAULT 'storefront';
