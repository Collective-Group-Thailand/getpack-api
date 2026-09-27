-- AlterTable
ALTER TABLE "instalments" ADD COLUMN     "order_line_id" BIGINT;

-- CreateIndex
CREATE INDEX "ix_instalments__order_line_id" ON "instalments"("order_line_id");

-- AddForeignKey
ALTER TABLE "instalments" ADD CONSTRAINT "fk_instalments__order_line_id" FOREIGN KEY ("order_line_id") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written: only a fixed-amount add-on instalment names the order line it pays (ADR-0008 item 6, A-36).
ALTER TABLE instalments
  ADD CONSTRAINT ck_instalments__add_on_line CHECK (order_line_id IS NULL OR fixed_amount);
