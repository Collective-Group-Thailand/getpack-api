-- Rollback of 20270107000001_sales_p5_capture_enums (manual; run after 20270107000002's down.sql). Items captured from
-- the new sources are removed with their assignment history (append-only: its trigger is suspended for the rollback);
-- assignments made by attribution are kept as manual ones.
ALTER TABLE sales_inbound_assignments DISABLE TRIGGER USER;
DELETE FROM sales_inbound_assignments
 WHERE inbound_lead_id IN (SELECT id FROM sales_inbound_leads WHERE source::text IN ('studio_idle', 'dieline_download'));
UPDATE sales_inbound_assignments SET mode = 'manual' WHERE mode::text = 'attribution';
ALTER TABLE sales_inbound_assignments ENABLE TRIGGER USER;
DELETE FROM sales_inbound_leads WHERE source::text IN ('studio_idle', 'dieline_download');

ALTER TYPE sales_inbound_assignment_mode RENAME TO sales_inbound_assignment_mode_p5;
CREATE TYPE sales_inbound_assignment_mode AS ENUM ('manual', 'round_robin');
ALTER TABLE sales_inbound_assignments
  ALTER COLUMN mode TYPE sales_inbound_assignment_mode USING mode::text::sales_inbound_assignment_mode;
DROP TYPE sales_inbound_assignment_mode_p5;

ALTER TYPE sales_inbound_source RENAME TO sales_inbound_source_p5;
CREATE TYPE sales_inbound_source AS ENUM ('contact_form', 'rfq', 'line_chat', 'manual');
ALTER TABLE sales_inbound_leads
  ALTER COLUMN source TYPE sales_inbound_source USING source::text::sales_inbound_source;
DROP TYPE sales_inbound_source_p5;
