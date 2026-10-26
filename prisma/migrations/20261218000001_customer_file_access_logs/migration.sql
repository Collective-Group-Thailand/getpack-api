-- Customer file access (Stage B task B-API-5, D-444; DECISIONS-STAGE-A §7 "Customer file access") — reversible:
-- `down.sql` in this folder undoes it.
--
-- `customer_file_access_logs`: one row per download URL issued for a customer's artwork / original, a production copy
-- of one (D-442) or an approved proof's locked copy — who (user or API client), when, which file, which order, through
-- which surface and for what (download / thumbnail). Never the URL, a token or the storage key. Append-only: a trigger
-- refuses UPDATE and DELETE (`forbid_mutation()`, as `audit_logs`).
-- CreateEnum
CREATE TYPE "customer_file_kind" AS ENUM ('customer_original', 'production_copy', 'approved_proof_copy');

-- CreateEnum
CREATE TYPE "file_access_channel" AS ENUM ('store', 'admin', 'partner');

-- CreateEnum
CREATE TYPE "file_access_purpose" AS ENUM ('download', 'thumbnail');

-- CreateTable
CREATE TABLE "customer_file_access_logs" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_type" "actor_type" NOT NULL,
    "actor_user_id" BIGINT,
    "actor_api_client_id" BIGINT,
    "file_object_id" BIGINT NOT NULL,
    "file_kind" "customer_file_kind" NOT NULL,
    "order_id" BIGINT,
    "channel" "file_access_channel" NOT NULL,
    "purpose" "file_access_purpose" NOT NULL,
    "request_id" TEXT,

    CONSTRAINT "pk_customer_file_access_logs" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_customer_file_access_logs__public_id" ON "customer_file_access_logs"("public_id");

-- CreateIndex
CREATE INDEX "ix_customer_file_access_logs__occurred_at" ON "customer_file_access_logs"("occurred_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "ix_customer_file_access_logs__order_id__occurred_at" ON "customer_file_access_logs"("order_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ix_customer_file_access_logs__file_object_id__occurred_at" ON "customer_file_access_logs"("file_object_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ix_customer_file_access_logs__actor_user_id__occurred_at" ON "customer_file_access_logs"("actor_user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ix_customer_file_access_logs__actor_api_client_id" ON "customer_file_access_logs"("actor_api_client_id");

-- AddForeignKey
ALTER TABLE "customer_file_access_logs" ADD CONSTRAINT "fk_customer_file_access_logs__actor_user_id" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_file_access_logs" ADD CONSTRAINT "fk_customer_file_access_logs__actor_api_client_id" FOREIGN KEY ("actor_api_client_id") REFERENCES "api_clients"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_file_access_logs" ADD CONSTRAINT "fk_customer_file_access_logs__file_object_id" FOREIGN KEY ("file_object_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_file_access_logs" ADD CONSTRAINT "fk_customer_file_access_logs__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- The actor columns follow the actor type (as `ck_audit_logs__actor`); a system or webhook actor is never logged here.
ALTER TABLE "customer_file_access_logs" ADD CONSTRAINT "ck_customer_file_access_logs__actor" CHECK (
  (actor_type = 'user' AND actor_user_id IS NOT NULL AND actor_api_client_id IS NULL) OR
  (actor_type = 'api_client' AND actor_api_client_id IS NOT NULL AND actor_user_id IS NULL));

CREATE TRIGGER tg_customer_file_access_logs__append_only BEFORE UPDATE OR DELETE ON "customer_file_access_logs"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
