-- Reverts 20261218000001_customer_file_access_logs (Prisma does not run this file; apply it by hand with psql, then
-- delete the migration's row from `_prisma_migrations` and redeploy the previous release).
--
-- The access log is dropped with its rows: export it first (admin.customerFileAccessLogs.list) if it must be kept.
DROP TRIGGER IF EXISTS tg_customer_file_access_logs__append_only ON "customer_file_access_logs";
DROP TABLE IF EXISTS "customer_file_access_logs";
DROP TYPE IF EXISTS "file_access_purpose";
DROP TYPE IF EXISTS "file_access_channel";
DROP TYPE IF EXISTS "customer_file_kind";
