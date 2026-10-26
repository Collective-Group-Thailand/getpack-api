-- B-API-4 (D-438) — reversible: `down.sql` in this folder undoes it. Data only, no schema change.
--
-- An own-file order ("มีไฟล์งานแล้ว") waits for the customer's file ("รอไฟล์จากคุณ", `awaiting_upload`) from the
-- start; checkout placed it at `awaiting_template` ("รอทีมส่งแบบไดคัทให้") until a dieline went out. Own-file orders
-- still at `awaiting_template`, not cancelled, with no accepted file move to `awaiting_upload`. Hired and online
-- designs are not touched. Pre-launch correction of a status, as A2 / D-425 did: no event or activity row is written.
UPDATE orders
   SET artwork_status = 'awaiting_upload',
       row_version = row_version + 1
 WHERE artwork_status = 'awaiting_template'
   AND cancelled_at IS NULL
   AND design_option = 'own_file'
   AND NOT EXISTS (SELECT 1 FROM artwork_submissions s
                    WHERE s.order_id = orders.id AND s.status = 'accepted_for_proof');
