-- B-API-6 (D-444): the support staff member who handles an order, set by CS Lead / Admin
-- (`PUT /v1/admin/orders/{orderId}/support-assignment`, `orders.assign_support`, audited). With
-- `customer_files.read_handled` the assignee reads the order's customer artwork. A change ends the live row
-- (`ended_at`) and adds a new one; one live row per order.

CREATE TABLE "order_support_assignments" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" BIGINT,
    "ended_at" TIMESTAMPTZ(6),
    "ended_by" BIGINT,

    CONSTRAINT "pk_order_support_assignments" PRIMARY KEY ("id"),
    CONSTRAINT "ck_order_support_assignments__ended" CHECK ("ended_at" IS NULL OR "ended_at" >= "assigned_at")
);

CREATE UNIQUE INDEX "ux_order_support_assignments__public_id" ON "order_support_assignments"("public_id");
CREATE INDEX "ix_order_support_assignments__order_id" ON "order_support_assignments"("order_id");
CREATE INDEX "ix_order_support_assignments__user_id" ON "order_support_assignments"("user_id");
CREATE INDEX "ix_order_support_assignments__assigned_by" ON "order_support_assignments"("assigned_by");
CREATE INDEX "ix_order_support_assignments__ended_by" ON "order_support_assignments"("ended_by");
CREATE UNIQUE INDEX "ux_order_support_assignments__one_live" ON "order_support_assignments"("order_id") WHERE ("ended_at" IS NULL);

ALTER TABLE "order_support_assignments" ADD CONSTRAINT "fk_order_support_assignments__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "order_support_assignments" ADD CONSTRAINT "fk_order_support_assignments__user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "order_support_assignments" ADD CONSTRAINT "fk_order_support_assignments__assigned_by" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "order_support_assignments" ADD CONSTRAINT "fk_order_support_assignments__ended_by" FOREIGN KEY ("ended_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
