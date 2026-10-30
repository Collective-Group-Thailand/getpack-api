-- bigint ids are identity columns, never serial sequences (schema-design §2.1). `shipment_handover_links` was
-- created with BIGSERIAL; this converts it, continuing after the highest id so existing rows keep theirs
-- (same as 20261231000002_identity_ids_stage_c).
DO $$
DECLARE
  next_id bigint;
BEGIN
  ALTER TABLE shipment_handover_links ALTER COLUMN id DROP DEFAULT;
  DROP SEQUENCE IF EXISTS shipment_handover_links_id_seq;
  SELECT coalesce(max(id), 0) + 1 FROM shipment_handover_links INTO next_id;
  EXECUTE format('ALTER TABLE shipment_handover_links ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (START WITH %s)', next_id);
END
$$;
