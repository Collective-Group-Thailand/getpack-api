-- CreateEnum
CREATE TYPE "shipment_status" AS ENUM ('draft', 'ready', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'returned', 'cancelled');

-- CreateEnum
CREATE TYPE "shipment_event_source" AS ENUM ('factory', 'carrier_webhook', 'carrier_poll', 'staff');

-- CreateEnum
CREATE TYPE "pod_kind" AS ENUM ('factory_photo_signature', 'carrier_pod');

-- CreateEnum
CREATE TYPE "tolerance_outcome" AS ENUM ('exact', 'shortage_within', 'overage_within', 'shortage_outside', 'overage_outside');

-- CreateTable
CREATE TABLE "shipments" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "shipment_no" TEXT NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "factory_id" BIGINT NOT NULL,
    "carrier_id" BIGINT NOT NULL,
    "carrier_booking_ref" TEXT,
    "tracking_no" TEXT,
    "tracking_url" TEXT,
    "booked_at" TIMESTAMPTZ(6),
    "status" "shipment_status" NOT NULL DEFAULT 'draft',
    "status_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipient_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "subdistrict_id" BIGINT,
    "postcode" CHAR(5) NOT NULL,
    "province_id" BIGINT NOT NULL,
    "cartons_count" INTEGER NOT NULL,
    "weight_g" INTEGER NOT NULL,
    "volume_cm3" BIGINT,
    "planned_ship_on" DATE,
    "ready_at" TIMESTAMPTZ(6),
    "picked_up_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "label_file_id" BIGINT,
    "packing_list_file_id" BIGINT,
    "customer_rate_version_id" BIGINT,
    "factory_payout_version_id" BIGINT,
    "payout_amount" DECIMAL(14,2),
    "carrier_cost_amount" DECIMAL(14,2),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_shipments" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_items" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "shipment_id" BIGINT NOT NULL,
    "order_id" BIGINT NOT NULL,
    "order_destination_id" BIGINT NOT NULL,
    "production_job_id" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "delivered_quantity" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_shipment_items" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_cartons" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "shipment_id" BIGINT NOT NULL,
    "seq" SMALLINT NOT NULL,
    "label_code" TEXT NOT NULL,
    "weight_g" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_shipment_cartons" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_events" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "shipment_id" BIGINT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "shipment_status" NOT NULL,
    "source" "shipment_event_source" NOT NULL,
    "location" TEXT,
    "note" TEXT,
    "carrier_event_id" TEXT,
    "provider_status" TEXT,
    "raw" JSONB,
    "recorded_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_shipment_events" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proofs_of_delivery" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "shipment_id" BIGINT NOT NULL,
    "kind" "pod_kind" NOT NULL,
    "receiver_name" TEXT NOT NULL,
    "signature_file_id" BIGINT,
    "delivered_quantity" INTEGER NOT NULL,
    "captured_at" TIMESTAMPTZ(6) NOT NULL,
    "captured_by" BIGINT,
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "carrier_pod_ref" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_proofs_of_delivery" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_reconciliations" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "order_id" BIGINT NOT NULL,
    "ordered_quantity" INTEGER NOT NULL,
    "delivered_quantity" INTEGER NOT NULL,
    "payable_quantity" INTEGER NOT NULL,
    "tolerance_shortage_pct" DECIMAL(7,4) NOT NULL,
    "tolerance_overage_pct" DECIMAL(7,4) NOT NULL,
    "deviation_pct" DECIMAL(9,4) NOT NULL,
    "outcome" "tolerance_outcome" NOT NULL,
    "credit_net_amount" DECIMAL(14,2),
    "credit_vat_amount" DECIMAL(14,2),
    "credit_amount" DECIMAL(14,2),
    "claim_id" BIGINT,
    "evaluated_at" TIMESTAMPTZ(6) NOT NULL,
    "domain_event_id" UUID,

    CONSTRAINT "pk_delivery_reconciliations" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_links" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "token_hash" BYTEA NOT NULL,
    "order_id" BIGINT NOT NULL,
    "shipment_id" BIGINT,
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "views" INTEGER NOT NULL DEFAULT 0,
    "last_viewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_tracking_links" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_shipments__public_id" ON "shipments"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_shipments__shipment_no" ON "shipments"("shipment_no");

-- CreateIndex
CREATE INDEX "ix_shipments__factory_id__status" ON "shipments"("factory_id", "status");

-- CreateIndex
CREATE INDEX "ix_shipments__tracking_no" ON "shipments"("tracking_no");

-- CreateIndex
CREATE INDEX "ix_shipments__carrier_id__carrier_booking_ref" ON "shipments"("carrier_id", "carrier_booking_ref");

-- CreateIndex
CREATE INDEX "ix_shipments__status__status_changed_at" ON "shipments"("status", "status_changed_at");

-- CreateIndex
CREATE INDEX "ix_shipments__entity_id" ON "shipments"("entity_id");

-- CreateIndex
CREATE INDEX "ix_shipments__subdistrict_id" ON "shipments"("subdistrict_id");

-- CreateIndex
CREATE INDEX "ix_shipments__province_id" ON "shipments"("province_id");

-- CreateIndex
CREATE INDEX "ix_shipments__label_file_id" ON "shipments"("label_file_id");

-- CreateIndex
CREATE INDEX "ix_shipments__packing_list_file_id" ON "shipments"("packing_list_file_id");

-- CreateIndex
CREATE INDEX "ix_shipments__customer_rate_version_id" ON "shipments"("customer_rate_version_id");

-- CreateIndex
CREATE INDEX "ix_shipments__factory_payout_version_id" ON "shipments"("factory_payout_version_id");

-- CreateIndex
CREATE INDEX "ix_shipments__created_by" ON "shipments"("created_by");

-- CreateIndex
CREATE INDEX "ix_shipments__updated_by" ON "shipments"("updated_by");

-- CreateIndex
CREATE INDEX "ix_shipment_items__order_id" ON "shipment_items"("order_id");

-- CreateIndex
CREATE INDEX "ix_shipment_items__order_destination_id" ON "shipment_items"("order_destination_id");

-- CreateIndex
CREATE INDEX "ix_shipment_items__production_job_id" ON "shipment_items"("production_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_shipment_items__shipment_id__order_destination_id" ON "shipment_items"("shipment_id", "order_destination_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_shipment_cartons__label_code" ON "shipment_cartons"("label_code");

-- CreateIndex
CREATE UNIQUE INDEX "ux_shipment_cartons__shipment_id__seq" ON "shipment_cartons"("shipment_id", "seq");

-- CreateIndex
CREATE INDEX "ix_shipment_events__shipment_id__occurred_at" ON "shipment_events"("shipment_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ix_shipment_events__recorded_by" ON "shipment_events"("recorded_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_shipment_events__shipment_id__carrier_event_id" ON "shipment_events"("shipment_id", "carrier_event_id") WHERE (carrier_event_id IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "ux_proofs_of_delivery__public_id" ON "proofs_of_delivery"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_proofs_of_delivery__shipment_id" ON "proofs_of_delivery"("shipment_id");

-- CreateIndex
CREATE INDEX "ix_proofs_of_delivery__signature_file_id" ON "proofs_of_delivery"("signature_file_id");

-- CreateIndex
CREATE INDEX "ix_proofs_of_delivery__captured_by" ON "proofs_of_delivery"("captured_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_delivery_reconciliations__order_id" ON "delivery_reconciliations"("order_id");

-- CreateIndex
CREATE INDEX "ix_delivery_reconciliations__claim_id" ON "delivery_reconciliations"("claim_id");

-- CreateIndex
CREATE INDEX "ix_delivery_reconciliations__domain_event_id" ON "delivery_reconciliations"("domain_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_tracking_links__token_hash" ON "tracking_links"("token_hash");

-- CreateIndex
CREATE INDEX "ix_tracking_links__order_id" ON "tracking_links"("order_id");

-- CreateIndex
CREATE INDEX "ix_tracking_links__shipment_id" ON "tracking_links"("shipment_id");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "fk_shipments__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "fk_shipments__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "fk_shipments__carrier_id" FOREIGN KEY ("carrier_id") REFERENCES "carriers"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "fk_shipments__subdistrict_id" FOREIGN KEY ("subdistrict_id") REFERENCES "geo_subdistricts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "fk_shipments__province_id" FOREIGN KEY ("province_id") REFERENCES "geo_provinces"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "fk_shipments__label_file_id" FOREIGN KEY ("label_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "fk_shipments__packing_list_file_id" FOREIGN KEY ("packing_list_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "fk_shipments__customer_rate_version_id" FOREIGN KEY ("customer_rate_version_id") REFERENCES "customer_shipping_rate_card_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "fk_shipments__factory_payout_version_id" FOREIGN KEY ("factory_payout_version_id") REFERENCES "factory_shipping_rate_card_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "fk_shipments__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "fk_shipments__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "fk_shipment_items__shipment_id" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "fk_shipment_items__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "fk_shipment_items__order_destination_id" FOREIGN KEY ("order_destination_id") REFERENCES "order_destinations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "fk_shipment_items__production_job_id" FOREIGN KEY ("production_job_id") REFERENCES "production_jobs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_cartons" ADD CONSTRAINT "fk_shipment_cartons__shipment_id" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_events" ADD CONSTRAINT "fk_shipment_events__shipment_id" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "shipment_events" ADD CONSTRAINT "fk_shipment_events__recorded_by" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "proofs_of_delivery" ADD CONSTRAINT "fk_proofs_of_delivery__shipment_id" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "proofs_of_delivery" ADD CONSTRAINT "fk_proofs_of_delivery__signature_file_id" FOREIGN KEY ("signature_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "proofs_of_delivery" ADD CONSTRAINT "fk_proofs_of_delivery__captured_by" FOREIGN KEY ("captured_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "delivery_reconciliations" ADD CONSTRAINT "fk_delivery_reconciliations__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "delivery_reconciliations" ADD CONSTRAINT "fk_delivery_reconciliations__domain_event_id" FOREIGN KEY ("domain_event_id") REFERENCES "domain_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tracking_links" ADD CONSTRAINT "fk_tracking_links__order_id" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tracking_links" ADD CONSTRAINT "fk_tracking_links__shipment_id" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- =====================================================================================================
-- Hand-written: shipments, items, cartons, events, proofs of delivery, reconciliations, tracking links
-- (D-013, D-021, D-080, D-081, D-114, D-142, D-165; schema-design §3.7, A-38)
-- =====================================================================================================
ALTER TABLE shipments
  ADD CONSTRAINT ck_shipments__shipment_no CHECK (btrim(shipment_no) <> ''),
  ADD CONSTRAINT ck_shipments__destination CHECK (
    btrim(recipient_name) <> '' AND btrim(line1) <> '' AND postcode ~ '^[0-9]{5}$'),
  ADD CONSTRAINT ck_shipments__phone_e164 CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT ck_shipments__measures CHECK (
    cartons_count > 0 AND weight_g > 0 AND (volume_cm3 IS NULL OR volume_cm3 > 0)),
  ADD CONSTRAINT ck_shipments__amounts CHECK (
    (payout_amount IS NULL OR payout_amount >= 0) AND (carrier_cost_amount IS NULL OR carrier_cost_amount >= 0)),
  ADD CONSTRAINT ck_shipments__payout_version CHECK (payout_amount IS NULL OR factory_payout_version_id IS NOT NULL),
  ADD CONSTRAINT ck_shipments__booking CHECK ((carrier_booking_ref IS NULL) = (booked_at IS NULL)),
  ADD CONSTRAINT ck_shipments__ready CHECK (status IN ('draft', 'cancelled') OR ready_at IS NOT NULL),
  ADD CONSTRAINT ck_shipments__picked_up CHECK (
    status NOT IN ('picked_up', 'in_transit', 'out_for_delivery', 'delivered') OR picked_up_at IS NOT NULL),
  ADD CONSTRAINT ck_shipments__delivered CHECK ((status = 'delivered') = (delivered_at IS NOT NULL)),
  ADD CONSTRAINT ck_shipments__cancelled CHECK (
    (status = 'cancelled') = (cancelled_at IS NOT NULL) AND (cancelled_at IS NULL OR cancel_reason IS NOT NULL));
CREATE TRIGGER tg_shipments__no_delete BEFORE DELETE ON shipments
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE shipment_items
  ADD CONSTRAINT ck_shipment_items__quantity CHECK (quantity > 0),
  ADD CONSTRAINT ck_shipment_items__delivered CHECK (delivered_quantity IS NULL OR delivered_quantity >= 0);
-- An item always serves a destination of its own order, made by a job of that order.
CREATE FUNCTION tg_shipment_items__same_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM order_destinations WHERE id = NEW.order_destination_id AND order_id = NEW.order_id)
     OR NOT EXISTS (SELECT 1 FROM production_jobs WHERE id = NEW.production_job_id AND order_id = NEW.order_id) THEN
    RAISE EXCEPTION 'shipment item % mixes orders', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_shipment_items__same_order BEFORE INSERT OR UPDATE ON shipment_items
  FOR EACH ROW EXECUTE FUNCTION tg_shipment_items__same_order();
CREATE TRIGGER tg_shipment_items__no_delete BEFORE DELETE ON shipment_items
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE shipment_cartons
  ADD CONSTRAINT ck_shipment_cartons__seq CHECK (seq > 0),
  ADD CONSTRAINT ck_shipment_cartons__label_code CHECK (label_code ~ '^[A-Z0-9-]{6,40}$'),
  ADD CONSTRAINT ck_shipment_cartons__weight CHECK (weight_g IS NULL OR weight_g > 0);

CREATE TRIGGER tg_shipment_events__append_only BEFORE UPDATE OR DELETE ON shipment_events
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_row_change();

ALTER TABLE proofs_of_delivery
  ADD CONSTRAINT ck_proofs_of_delivery__receiver CHECK (btrim(receiver_name) <> ''),
  ADD CONSTRAINT ck_proofs_of_delivery__quantity CHECK (delivered_quantity >= 0),
  -- D-013: a factory delivery proves itself with a signature (photos are attachments); a carrier by its POD.
  ADD CONSTRAINT ck_proofs_of_delivery__evidence CHECK (
    (kind = 'factory_photo_signature' AND signature_file_id IS NOT NULL)
    OR (kind = 'carrier_pod' AND carrier_pod_ref IS NOT NULL)),
  ADD CONSTRAINT ck_proofs_of_delivery__coordinates CHECK (
    (lat IS NULL) = (lng IS NULL) AND (lat IS NULL OR (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)));
CREATE TRIGGER tg_proofs_of_delivery__append_only BEFORE UPDATE OR DELETE ON proofs_of_delivery
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_row_change();

ALTER TABLE delivery_reconciliations
  ADD CONSTRAINT ck_delivery_reconciliations__quantities CHECK (
    ordered_quantity > 0 AND delivered_quantity >= 0
    AND payable_quantity = least(delivered_quantity, ordered_quantity)),
  ADD CONSTRAINT ck_delivery_reconciliations__tolerance CHECK (
    tolerance_shortage_pct BETWEEN 0 AND 100 AND tolerance_overage_pct BETWEEN 0 AND 100),
  ADD CONSTRAINT ck_delivery_reconciliations__credit CHECK (
    (outcome = 'shortage_within') = (credit_amount IS NOT NULL)
    AND (credit_amount IS NULL OR (credit_net_amount IS NOT NULL AND credit_vat_amount IS NOT NULL
      AND credit_net_amount >= 0 AND credit_vat_amount >= 0 AND credit_amount = credit_net_amount + credit_vat_amount))),
  ADD CONSTRAINT ck_delivery_reconciliations__outcome CHECK (
    (outcome = 'exact') = (delivered_quantity = ordered_quantity)
    AND (outcome NOT IN ('shortage_within', 'shortage_outside') OR delivered_quantity < ordered_quantity)
    AND (outcome NOT IN ('overage_within', 'overage_outside') OR delivered_quantity > ordered_quantity));
-- The evaluation is a fact; only the automatic claim link is filled in afterwards (B4.5).
CREATE FUNCTION tg_delivery_reconciliations__write_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'delivery reconciliations are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'claim_id' - 'domain_event_id') <> (to_jsonb(OLD) - 'claim_id' - 'domain_event_id')
     OR (OLD.claim_id IS NOT NULL AND NEW.claim_id IS DISTINCT FROM OLD.claim_id)
     OR (OLD.domain_event_id IS NOT NULL AND NEW.domain_event_id IS DISTINCT FROM OLD.domain_event_id) THEN
    RAISE EXCEPTION 'delivery reconciliation % is write-once', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_delivery_reconciliations__write_once BEFORE UPDATE OR DELETE ON delivery_reconciliations
  FOR EACH ROW EXECUTE FUNCTION tg_delivery_reconciliations__write_once();

ALTER TABLE tracking_links
  ADD CONSTRAINT ck_tracking_links__token_hash CHECK (octet_length(token_hash) = 32),
  ADD CONSTRAINT ck_tracking_links__views CHECK (views >= 0);
