-- U3.B4 (schema-design A-92; D-266–D-269): the price path of every style variant (instant only with a signed calculator
-- and every option priced) with its reasons; option price rules (Prepress, never edited); RFQs naming a style variant;
-- the dieline-derived quantities frozen on a quote.
-- CreateEnum
CREATE TYPE "style_price_path" AS ENUM ('instant', 'rfq');

-- CreateEnum
CREATE TYPE "style_option_price_effect" AS ENUM ('neutral', 'configuration');

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "dieline_quantities" JSONB;

-- AlterTable
ALTER TABLE "rfqs" ADD COLUMN     "style_variant_id" BIGINT;

-- AlterTable
ALTER TABLE "style_variants" ADD COLUMN     "price_path" "style_price_path" NOT NULL DEFAULT 'rfq',
ADD COLUMN     "price_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "style_option_price_rules" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "calculator_key" "calculator_key" NOT NULL,
    "axis" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "effect" "style_option_price_effect" NOT NULL,
    "patch" JSONB,
    "note" TEXT NOT NULL,
    "status" "style_status" NOT NULL DEFAULT 'active',
    "created_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMPTZ(6),
    "retired_by" BIGINT,

    CONSTRAINT "pk_style_option_price_rules" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_style_option_price_rules__public_id" ON "style_option_price_rules"("public_id");

-- CreateIndex
CREATE INDEX "ix_style_option_price_rules__created_by" ON "style_option_price_rules"("created_by");

-- CreateIndex
CREATE INDEX "ix_style_option_price_rules__retired_by" ON "style_option_price_rules"("retired_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_style_option_price_rules__active" ON "style_option_price_rules"("calculator_key", "axis", "value") WHERE (status = 'active'::style_status);

-- CreateIndex
CREATE INDEX "ix_rfqs__style_variant_id" ON "rfqs"("style_variant_id");

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "fk_rfqs__style_variant_id" FOREIGN KEY ("style_variant_id") REFERENCES "style_variants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_option_price_rules" ADD CONSTRAINT "fk_style_option_price_rules__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_option_price_rules" ADD CONSTRAINT "fk_style_option_price_rules__retired_by" FOREIGN KEY ("retired_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written checks and triggers (A-92).
ALTER TABLE style_variants
  ADD CONSTRAINT ck_style_variants__price_path CHECK (price_path <> 'instant' OR cardinality(price_reasons) = 0);
ALTER TABLE style_option_price_rules
  ADD CONSTRAINT ck_style_option_price_rules__patch CHECK (
    (effect = 'neutral' AND patch IS NULL) OR (effect = 'configuration' AND jsonb_typeof(patch) = 'object')),
  ADD CONSTRAINT ck_style_option_price_rules__note CHECK (btrim(note) <> ''),
  ADD CONSTRAINT ck_style_option_price_rules__retired CHECK ((status = 'retired') = (retired_at IS NOT NULL));
ALTER TABLE quotes
  ADD CONSTRAINT ck_quotes__dieline_quantities CHECK (dieline_quantities IS NULL OR jsonb_typeof(dieline_quantities) = 'object');
-- D-268: a rule is never edited — it is retired and a new one added; only the retirement columns change, once.
CREATE FUNCTION tg_style_option_price_rules__frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'option price rules are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.calculator_key <> OLD.calculator_key OR NEW.axis <> OLD.axis OR NEW.value <> OLD.value
     OR NEW.effect <> OLD.effect OR NEW.patch IS DISTINCT FROM OLD.patch OR NEW.note <> OLD.note
     OR OLD.status = 'retired' THEN
    RAISE EXCEPTION 'option price rule % is frozen', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_style_option_price_rules__frozen BEFORE UPDATE OR DELETE ON style_option_price_rules
  FOR EACH ROW EXECUTE FUNCTION tg_style_option_price_rules__frozen();
-- D-267: the quantities are frozen with the quote (set at save, never changed).
CREATE FUNCTION tg_quotes__dieline_write_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.dieline_quantities IS DISTINCT FROM OLD.dieline_quantities THEN
    RAISE EXCEPTION 'quote % dieline quantities are write-once', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_quotes__dieline_write_once BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION tg_quotes__dieline_write_once();
