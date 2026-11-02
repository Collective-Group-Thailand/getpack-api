-- D-467 (agent portal pack, Phase 2): agent notification preferences (event x channel, rows only for changes), the zone
-- of each web-push subscription (agent events push to agent-zone browsers only) and the once-per-threshold markers of
-- the lead protection reminder (7 and 1 days). Non-destructive. Rollback: down.sql.
-- CreateEnum
CREATE TYPE "sales_agent_notification_event" AS ENUM ('lead_converted', 'lead_protection_expiring', 'commission_earned', 'statement_ready', 'payout_paid', 'payout_profile_needed');

-- AlterTable
ALTER TABLE "sales_agent_leads" ADD COLUMN     "protection_reminded_1d_at" TIMESTAMPTZ(6),
ADD COLUMN     "protection_reminded_7d_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "web_push_subscriptions" ADD COLUMN     "client" "auth_client" NOT NULL DEFAULT 'storefront';

-- CreateTable
CREATE TABLE "sales_agent_notification_preferences" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "agent_id" BIGINT NOT NULL,
    "event" "sales_agent_notification_event" NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_sales_agent_notification_preferences" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_notification_preferences__agent__event__channel" ON "sales_agent_notification_preferences"("agent_id", "event", "channel");

-- AddForeignKey
ALTER TABLE "sales_agent_notification_preferences" ADD CONSTRAINT "fk_sales_agent_notification_preferences__agent_id" FOREIGN KEY ("agent_id") REFERENCES "sales_agents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

