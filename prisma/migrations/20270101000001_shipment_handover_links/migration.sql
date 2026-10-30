-- D-462 (sealed carrier label, supersedes D-142 for partner-facing documents): carton labels and packing lists carry
-- no recipient identity; the recipient's name, phone and address reach the carrier / driver only through a
-- handover link issued by getpack staff. The token is random and stored as SHA-256 only; one live link per
-- shipment (regenerating revokes the previous one); every open is written to `audit_logs` (`data_access`).

-- CreateTable
CREATE TABLE "shipment_handover_links" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "shipment_id" BIGINT NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "last_opened_at" TIMESTAMPTZ(6),
    "pickup_confirmed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,

    CONSTRAINT "pk_shipment_handover_links" PRIMARY KEY ("id"),
    CONSTRAINT "ck_shipment_handover_links__token_hash" CHECK (octet_length("token_hash") = 32),
    CONSTRAINT "ck_shipment_handover_links__open_count" CHECK ("open_count" >= 0),
    CONSTRAINT "ck_shipment_handover_links__expiry" CHECK ("expires_at" > "created_at")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_shipment_handover_links__public_id" ON "shipment_handover_links"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_shipment_handover_links__token_hash" ON "shipment_handover_links"("token_hash");

-- CreateIndex
CREATE INDEX "ix_shipment_handover_links__shipment_id" ON "shipment_handover_links"("shipment_id");

-- CreateIndex
CREATE INDEX "ix_shipment_handover_links__created_by" ON "shipment_handover_links"("created_by");

-- CreateIndex: one live (not revoked) link per shipment
CREATE UNIQUE INDEX "ux_shipment_handover_links__one_live" ON "shipment_handover_links"("shipment_id") WHERE (revoked_at IS NULL);

-- AddForeignKey
ALTER TABLE "shipment_handover_links" ADD CONSTRAINT "fk_shipment_handover_links__shipment_id" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_handover_links" ADD CONSTRAINT "fk_shipment_handover_links__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
