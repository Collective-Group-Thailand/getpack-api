-- U4.B2 (schema-design A-96; D-277): the studio design version and spec hash a quotation was priced from, the design
-- version an RFQ was asked from, and studio quote snapshots by spec hash (cache window + price-change reasons).

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "design_document_version_id" BIGINT,
ADD COLUMN     "spec_hash" BYTEA;

-- AlterTable
ALTER TABLE "rfqs" ADD COLUMN     "design_document_version_id" BIGINT;

-- CreateTable
CREATE TABLE "studio_quote_snapshots" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "spec_hash" BYTEA NOT NULL,
    "product_type_id" BIGINT NOT NULL,
    "input" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "priced_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_studio_quote_snapshots" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_studio_quote_snapshots__spec_hash" ON "studio_quote_snapshots"("spec_hash");

-- CreateIndex
CREATE INDEX "ix_studio_quote_snapshots__product_type_id" ON "studio_quote_snapshots"("product_type_id");

-- CreateIndex
CREATE INDEX "ix_studio_quote_snapshots__created_at" ON "studio_quote_snapshots"("created_at");

-- CreateIndex
CREATE INDEX "ix_quotes__design_document_version_id" ON "quotes"("design_document_version_id");

-- CreateIndex
CREATE INDEX "ix_quotes__spec_hash" ON "quotes"("spec_hash");

-- CreateIndex
CREATE INDEX "ix_rfqs__design_document_version_id" ON "rfqs"("design_document_version_id");

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "fk_quotes__design_document_version_id" FOREIGN KEY ("design_document_version_id") REFERENCES "design_document_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "fk_rfqs__design_document_version_id" FOREIGN KEY ("design_document_version_id") REFERENCES "design_document_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "studio_quote_snapshots" ADD CONSTRAINT "fk_studio_quote_snapshots__product_type_id" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- Hand-written checks and triggers (A-96).
ALTER TABLE quotes
  ADD CONSTRAINT ck_quotes__spec_hash CHECK (spec_hash IS NULL OR octet_length(spec_hash) = 32),
  ADD CONSTRAINT ck_quotes__studio CHECK ((design_document_version_id IS NULL) = (spec_hash IS NULL));
ALTER TABLE studio_quote_snapshots
  ADD CONSTRAINT ck_studio_quote_snapshots__spec_hash CHECK (octet_length(spec_hash) = 32),
  ADD CONSTRAINT ck_studio_quote_snapshots__input CHECK (jsonb_typeof(input) = 'object'),
  ADD CONSTRAINT ck_studio_quote_snapshots__result CHECK (jsonb_typeof(result) = 'object');
-- D-277: the version and spec a quotation was priced from never change.
CREATE FUNCTION tg_quotes__studio_write_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.design_document_version_id IS DISTINCT FROM OLD.design_document_version_id
     OR NEW.spec_hash IS DISTINCT FROM OLD.spec_hash THEN
    RAISE EXCEPTION 'quote % studio version is write-once', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_quotes__studio_write_once BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION tg_quotes__studio_write_once();
