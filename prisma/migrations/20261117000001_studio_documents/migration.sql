-- U4.B1 (schema-design A-95; D-275, D-276): the studio box on design documents (style variant, print method, print
-- sides, finishes) with its snapshot and the calculator spec on every version; the design version pinned on cart
-- items and orders; the version an order locked.
-- CreateEnum
CREATE TYPE "print_method" AS ENUM ('digital', 'offset', 'flexo', 'none');

-- CreateEnum
CREATE TYPE "print_sides" AS ENUM ('outside', 'inside', 'both', 'none');

-- AlterTable
ALTER TABLE "cart_items" ADD COLUMN     "design_document_version_id" BIGINT;

-- AlterTable
ALTER TABLE "design_document_versions" ADD COLUMN     "box" JSONB,
ADD COLUMN     "spec" JSONB;

-- AlterTable
ALTER TABLE "design_documents" ADD COLUMN     "finishes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "locked_at" TIMESTAMPTZ(6),
ADD COLUMN     "locked_by_order_id" BIGINT,
ADD COLUMN     "locked_version_id" BIGINT,
ADD COLUMN     "print_method" "print_method",
ADD COLUMN     "print_sides" "print_sides",
ADD COLUMN     "style_variant_id" BIGINT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "design_document_version_id" BIGINT;

-- CreateIndex
CREATE INDEX "ix_cart_items__design_document_version_id" ON "cart_items"("design_document_version_id");

-- CreateIndex
CREATE INDEX "ix_design_documents__style_variant_id" ON "design_documents"("style_variant_id");

-- CreateIndex
CREATE INDEX "ix_design_documents__locked_version_id" ON "design_documents"("locked_version_id");

-- CreateIndex
CREATE INDEX "ix_design_documents__locked_by_order_id" ON "design_documents"("locked_by_order_id");

-- CreateIndex
CREATE INDEX "ix_orders__design_document_version_id" ON "orders"("design_document_version_id");

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "fk_cart_items__design_document_version_id" FOREIGN KEY ("design_document_version_id") REFERENCES "design_document_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "fk_orders__design_document_version_id" FOREIGN KEY ("design_document_version_id") REFERENCES "design_document_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_documents" ADD CONSTRAINT "fk_design_documents__style_variant_id" FOREIGN KEY ("style_variant_id") REFERENCES "style_variants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_documents" ADD CONSTRAINT "fk_design_documents__locked_version_id" FOREIGN KEY ("locked_version_id") REFERENCES "design_document_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_documents" ADD CONSTRAINT "fk_design_documents__locked_by_order_id" FOREIGN KEY ("locked_by_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- Hand-written checks and triggers (A-95).
ALTER TABLE design_document_versions
  ADD CONSTRAINT ck_design_document_versions__box CHECK (box IS NULL OR jsonb_typeof(box) = 'object'),
  ADD CONSTRAINT ck_design_document_versions__spec CHECK (spec IS NULL OR jsonb_typeof(spec) = 'object');
ALTER TABLE design_documents
  ADD CONSTRAINT ck_design_documents__lock CHECK (
    (locked_version_id IS NULL) = (locked_by_order_id IS NULL) AND (locked_version_id IS NULL) = (locked_at IS NULL));
ALTER TABLE cart_items
  ADD CONSTRAINT ck_cart_items__design_version CHECK (design_document_version_id IS NULL OR design_document_id IS NOT NULL);
ALTER TABLE orders
  ADD CONSTRAINT ck_orders__design_version CHECK (design_document_version_id IS NULL OR design_document_id IS NOT NULL);
-- D-276: a pinned version is a version of the line's design; an order's version never changes once set.
CREATE FUNCTION tg_design_version_of_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'orders' AND TG_OP = 'UPDATE'
     AND OLD.design_document_version_id IS NOT NULL
     AND NEW.design_document_version_id IS DISTINCT FROM OLD.design_document_version_id THEN
    RAISE EXCEPTION 'order % design version is write-once', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.design_document_version_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM design_document_versions v
        WHERE v.id = NEW.design_document_version_id AND v.document_id = NEW.design_document_id) THEN
    RAISE EXCEPTION 'design version % is not a version of design %', NEW.design_document_version_id,
      NEW.design_document_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_cart_items__design_version BEFORE INSERT OR UPDATE OF design_document_id, design_document_version_id
  ON cart_items FOR EACH ROW EXECUTE FUNCTION tg_design_version_of_document();
CREATE TRIGGER tg_orders__design_version BEFORE INSERT OR UPDATE OF design_document_id, design_document_version_id
  ON orders FOR EACH ROW EXECUTE FUNCTION tg_design_version_of_document();
