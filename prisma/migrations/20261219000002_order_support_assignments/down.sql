-- Reverts 20261219000002_order_support_assignments (Prisma does not run this file; apply it by hand with psql, then
-- delete the migration's row from `_prisma_migrations` and redeploy the previous release). The assignments are lost
-- (export first); support keeps access through open order conversations only.
DROP TABLE IF EXISTS "order_support_assignments";
