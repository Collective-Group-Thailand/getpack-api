-- U1 U-B0.2 slice 9 (schema-design A-63): bigint ids are identity columns, never serial sequences
-- (schema-design §2.1). Tables added in U-B0.1 and this slice were created with BIGSERIAL; this converts them,
-- continuing after the highest id so existing rows keep theirs.
DO $$
DECLARE
  t text;
  next_id bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['privacy_requests', 'support_tickets', 'company_brand_assets', 'proof_of_delivery_reviews'] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN id DROP DEFAULT', t);
    EXECUTE format('DROP SEQUENCE IF EXISTS %I', t || '_id_seq');
    EXECUTE format('SELECT coalesce(max(id), 0) + 1 FROM %I', t) INTO next_id;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (START WITH %s)', t, next_id);
  END LOOP;
END
$$;
