-- Reverts 20261217000001_own_file_awaiting_upload (Prisma does not run this file; apply it by hand with psql, then
-- delete the migration's row from `_prisma_migrations` and redeploy the previous release).
--
-- Own-file orders still waiting for the customer's first file, with no dieline sent, return to `awaiting_template`
-- as the previous release placed them. Orders whose dieline was sent stay `awaiting_upload`: the previous release
-- also moved them there when the dieline went out.
UPDATE orders
   SET artwork_status = 'awaiting_template',
       row_version = row_version + 1
 WHERE artwork_status = 'awaiting_upload'
   AND cancelled_at IS NULL
   AND design_option = 'own_file'
   AND NOT EXISTS (SELECT 1 FROM dieline_deliveries d WHERE d.order_id = orders.id)
   AND NOT EXISTS (SELECT 1 FROM artwork_submissions s WHERE s.order_id = orders.id);
