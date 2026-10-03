-- U2.6 (schema-design A-101; D-287): packaging spec sheets generated per order, language and content hash.
-- CreateTable
CREATE TABLE "order_spec_sheets" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "order_id" BIGINT NOT NULL,
    "lang" TEXT NOT NULL,
    "content_sha256" BYTEA NOT NULL,
    "file_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_order_spec_sheets" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_order_spec_sheets__file_id" ON "order_spec_sheets"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_order_spec_sheets__order__lang__content" ON "order_spec_sheets"("order_id", "lang", "content_sha256");

-- AddForeignKey
ALTER TABLE "order_spec_sheets" ADD CONSTRAINT "fk_order_spec_sheets__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_spec_sheets" ADD CONSTRAINT "fk_order_spec_sheets__file_id" FOREIGN KEY ("file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written checks and triggers (A-101).
ALTER TABLE order_spec_sheets
  ADD CONSTRAINT ck_order_spec_sheets__lang CHECK (lang IN ('th', 'en')),
  ADD CONSTRAINT ck_order_spec_sheets__content CHECK (octet_length(content_sha256) = 32);
CREATE TRIGGER tg_order_spec_sheets__write_once BEFORE UPDATE OR DELETE ON order_spec_sheets
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
