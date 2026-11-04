-- Rollback of 20270109000001_agent_p7_waitlist (manual: run with psql, then delete the migration's row from
-- `_prisma_migrations` and redeploy the previous release). The waiting list is lost: export it first
-- (`admin.agentWaitlist.export`) if it must be kept. The consent records it relied on stay.
DROP TABLE IF EXISTS "sales_agent_waitlist";
