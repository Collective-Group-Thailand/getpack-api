-- Account Phase 0 (getpack redesign, step A2) — reversible: `down.sql` in this folder undoes it.
--
-- D-438: the artwork status "รอแบบไดคัท" (`awaiting_template`) meant either side could be waiting. It is split by
-- who acts: `awaiting_template` now reads "รอทีมส่งแบบไดคัทให้" (the team sends the dieline; no upload button) and
-- `awaiting_upload` "รอไฟล์จากคุณ" (the customer sends the file). Enum values never change (D-313); the orders
-- whose next artwork step is the customer's move to `awaiting_upload`:
--   (1) online designs: no dieline comes from the team (`drawings.auto_send` serves own-file orders only), the
--       customer submits the design (`store.designs.submitForOrder`);
--   (2) orders whose dieline was already sent (a `dieline_deliveries` row) but still read `awaiting_template`.
-- Pre-launch correction of a status, as D-425 did for reference text: no event or activity row is written.
UPDATE orders
   SET artwork_status = 'awaiting_upload',
       row_version = row_version + 1
 WHERE artwork_status = 'awaiting_template'
   AND cancelled_at IS NULL
   AND (design_option = 'online_designer'
        OR EXISTS (SELECT 1 FROM dieline_deliveries d WHERE d.order_id = orders.id));

-- D-439 (GLOBAL-RULES §1, D-435): the customer's word for the `job_received` production step never names a factory
-- ("โรงงานรับงานแล้ว" → "รับงานเข้าผลิตแล้ว"), in every route version, approved ones included (same correction).
ALTER TABLE milestone_route_steps DISABLE TRIGGER tg_milestone_route_steps__draft_only;
UPDATE milestone_route_steps
   SET customer_label_th = 'รับงานเข้าผลิตแล้ว'
 WHERE key = 'job_received'
   AND customer_label_th = 'โรงงานรับงานแล้ว';
ALTER TABLE milestone_route_steps ENABLE TRIGGER tg_milestone_route_steps__draft_only;
