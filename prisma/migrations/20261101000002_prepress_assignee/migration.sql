-- U1 U-B0.2 slice 5 (schema-design A-62): the Prepress owner of an order's artwork.

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "prepress_assignee_id" BIGINT;

-- CreateIndex
CREATE INDEX "ix_orders__prepress_assignee_id" ON "orders"("prepress_assignee_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "fk_orders__prepress_assignee_id" FOREIGN KEY ("prepress_assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

