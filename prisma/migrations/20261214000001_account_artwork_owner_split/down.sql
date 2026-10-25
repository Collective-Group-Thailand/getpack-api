-- Reverts 20261214000001_account_artwork_owner_split (Prisma does not run this file; apply it by hand with psql,
-- then delete the migration's row from `_prisma_migrations` and redeploy the previous release).
--
-- Online-design orders still waiting for the customer's first file return to `awaiting_template`, as the previous
-- release placed them. Orders whose dieline was sent stay `awaiting_upload`: the previous release also moved them
-- there when the dieline went out.
UPDATE orders
   SET artwork_status = 'awaiting_template',
       row_version = row_version + 1
 WHERE artwork_status = 'awaiting_upload'
   AND cancelled_at IS NULL
   AND design_option = 'online_designer'
   AND NOT EXISTS (SELECT 1 FROM dieline_deliveries d WHERE d.order_id = orders.id)
   AND NOT EXISTS (SELECT 1 FROM artwork_submissions s WHERE s.order_id = orders.id);

ALTER TABLE milestone_route_steps DISABLE TRIGGER tg_milestone_route_steps__draft_only;
UPDATE milestone_route_steps
   SET customer_label_th = 'โรงงานรับงานแล้ว'
 WHERE key = 'job_received'
   AND customer_label_th = 'รับงานเข้าผลิตแล้ว';
ALTER TABLE milestone_route_steps ENABLE TRIGGER tg_milestone_route_steps__draft_only;
