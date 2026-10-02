-- U2.1 (schema-design A-81, D-184, D-211, finding F6): public style codes. A style is published at its first activation;
-- from then on its code and its style code never change, whoever writes the row (admin, import, seed).

-- AlterTable
ALTER TABLE "patterns" ADD COLUMN     "international_name" TEXT,
ADD COLUMN     "international_name_verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "published_at" TIMESTAMPTZ(6),
ADD COLUMN     "style_code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ux_patterns__style_code" ON "patterns"("style_code");


-- Hand-written (A-81)
ALTER TABLE patterns
  ADD CONSTRAINT ck_patterns__style_code CHECK (style_code IS NULL OR style_code ~ '^PK-[A-Z0-9]{2,8}-[0-9]{2,3}$'),
  ADD CONSTRAINT ck_patterns__international_name CHECK (
    (international_name IS NULL AND international_name_verified_at IS NULL)
    OR (btrim(international_name) <> '' AND international_name_verified_at IS NOT NULL));

-- Styles active today are published.
UPDATE patterns SET published_at = updated_at WHERE status = 'active' AND published_at IS NULL;

CREATE FUNCTION patterns_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.published_at IS NOT NULL THEN
    NEW.published_at := OLD.published_at;
    IF NEW.code IS DISTINCT FROM OLD.code THEN
      RAISE EXCEPTION 'pattern % is published: its code cannot change (D-184)', OLD.code USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.style_code IS NOT NULL AND NEW.style_code IS DISTINCT FROM OLD.style_code THEN
      RAISE EXCEPTION 'pattern % is published: its style code cannot change (D-184)', OLD.code USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.status = 'active' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_patterns__publication BEFORE INSERT OR UPDATE ON patterns
  FOR EACH ROW EXECUTE FUNCTION patterns_publication();
