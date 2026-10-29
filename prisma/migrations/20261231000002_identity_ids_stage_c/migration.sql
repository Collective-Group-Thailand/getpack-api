-- Stage C (C9): bigint ids are identity columns, never serial sequences (schema-design §2.1). These tables were
-- created with BIGSERIAL; this converts them, continuing after the highest id so existing rows keep theirs
-- (same as 20261220000001_identity_ids_stage_b).
DO $$
DECLARE
  t text;
  next_id bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['file_checks', 'file_check_versions'] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN id DROP DEFAULT', t);
    EXECUTE format('DROP SEQUENCE IF EXISTS %I', t || '_id_seq');
    EXECUTE format('SELECT coalesce(max(id), 0) + 1 FROM %I', t) INTO next_id;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (START WITH %s)', t, next_id);
  END LOOP;
END
$$;
