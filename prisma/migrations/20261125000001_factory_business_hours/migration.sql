-- U2.9 (schema-design A-106; D-292, D-209): a factory's weekly hours, effective-dated.
-- CreateTable
CREATE TABLE "factory_business_hours" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "effective_from" DATE NOT NULL,
    "hours" JSONB NOT NULL,
    "created_by" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_factory_business_hours" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_factory_business_hours__public_id" ON "factory_business_hours"("public_id");

-- CreateIndex
CREATE INDEX "ix_factory_business_hours__created_by" ON "factory_business_hours"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_factory_business_hours__factory_id__effective_from" ON "factory_business_hours"("factory_id", "effective_from");

-- AddForeignKey
ALTER TABLE "factory_business_hours" ADD CONSTRAINT "fk_factory_business_hours__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "factory_business_hours" ADD CONSTRAINT "fk_factory_business_hours__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written checks and triggers (A-106).
ALTER TABLE factory_business_hours
  ADD CONSTRAINT ck_factory_business_hours__hours CHECK (
    jsonb_typeof(hours) = 'object'
    AND hours ?& ARRAY['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
-- A version already in force (effective_from on or before today in Asia/Bangkok) is never changed or removed.
CREATE FUNCTION tg_factory_business_hours__in_force_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.effective_from <= (now() AT TIME ZONE 'Asia/Bangkok')::date THEN
    RAISE EXCEPTION 'factory hours in force since % are frozen', OLD.effective_from USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.factory_id <> OLD.factory_id OR NEW.effective_from <> OLD.effective_from THEN
    RAISE EXCEPTION 'a factory hours version keeps its factory and day' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_factory_business_hours__in_force_frozen BEFORE UPDATE OR DELETE ON factory_business_hours
  FOR EACH ROW EXECUTE FUNCTION tg_factory_business_hours__in_force_frozen();
