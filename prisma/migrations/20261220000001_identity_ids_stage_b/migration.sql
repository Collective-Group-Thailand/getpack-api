-- Stage B (B-API-5/6/7): bigint ids are identity columns, never serial sequences (schema-design §2.1). These tables
-- were created with BIGSERIAL; this converts them, continuing after the highest id so existing rows keep theirs
-- (same as 20261101000004_identity_ids).
DO $$
DECLARE
  t text;
  next_id bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['customer_file_access_logs', 'catalog_product_print_models', 'order_support_assignments'] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN id DROP DEFAULT', t);
    EXECUTE format('DROP SEQUENCE IF EXISTS %I', t || '_id_seq');
    EXECUTE format('SELECT coalesce(max(id), 0) + 1 FROM %I', t) INTO next_id;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (START WITH %s)', t, next_id);
  END LOOP;
END
$$;
