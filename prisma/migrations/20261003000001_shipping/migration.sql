-- B2.4 shipping rate cards and carriers (docs/schema-design.md §3.5, D-013, D-114).

-- CreateEnum
CREATE TYPE "carrier_code" AS ENUM ('factory_fleet', 'flash_express', 'deliveree');

-- CreateEnum
CREATE TYPE "carrier_capability" AS ENUM ('quote', 'book', 'label', 'track', 'cancel', 'webhook');

-- CreateEnum
CREATE TYPE "carrier_account_status" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "rate_line_acceptance" AS ENUM ('pending', 'accepted', 'countered');

-- CreateTable
CREATE TABLE "customer_shipping_rate_cards" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "decision_refs" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,

    CONSTRAINT "pk_customer_shipping_rate_cards" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_shipping_rate_card_versions" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "card_id" BIGINT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "scheme_id" BIGINT NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "status" "config_version_status" NOT NULL DEFAULT 'draft',
    "reason" TEXT NOT NULL,
    "approval_request_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" BIGINT,

    CONSTRAINT "pk_customer_shipping_rate_card_versions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_shipping_rates" (
    "id" BIGSERIAL NOT NULL,
    "version_id" BIGINT NOT NULL,
    "scheme_id" BIGINT NOT NULL,
    "zone_id" BIGINT NOT NULL,
    "postcode" CHAR(5),
    "weight_min_g" INTEGER NOT NULL,
    "weight_max_g" INTEGER,
    "volume_min_cm3" BIGINT,
    "volume_max_cm3" BIGINT,
    "price_amount" DECIMAL(14,2) NOT NULL,
    "per_extra_kg" DECIMAL(18,6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_customer_shipping_rates" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_shipping_rate_cards" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "factory_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,

    CONSTRAINT "pk_factory_shipping_rate_cards" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_shipping_rate_card_versions" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "card_id" BIGINT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "scheme_id" BIGINT NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "status" "config_version_status" NOT NULL DEFAULT 'draft',
    "reason" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(6),
    "sent_by" BIGINT,
    "factory_accepted_at" TIMESTAMPTZ(6),
    "factory_accepted_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" BIGINT,

    CONSTRAINT "pk_factory_shipping_rate_card_versions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_shipping_rates" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "version_id" BIGINT NOT NULL,
    "scheme_id" BIGINT NOT NULL,
    "zone_id" BIGINT NOT NULL,
    "postcode" CHAR(5),
    "weight_min_g" INTEGER NOT NULL,
    "weight_max_g" INTEGER,
    "volume_min_cm3" BIGINT,
    "volume_max_cm3" BIGINT,
    "payout_amount" DECIMAL(14,2) NOT NULL,
    "per_extra_kg" DECIMAL(18,6),
    "acceptance" "rate_line_acceptance" NOT NULL DEFAULT 'pending',
    "counter_amount" DECIMAL(14,2),
    "counter_per_extra_kg" DECIMAL(18,6),
    "counter_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_factory_shipping_rates" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carriers" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "code" "carrier_code" NOT NULL,
    "name" TEXT NOT NULL,
    "adapter_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "supports" "carrier_capability"[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_carriers" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carrier_accounts" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_id" BIGINT NOT NULL,
    "carrier_id" BIGINT NOT NULL,
    "label" TEXT NOT NULL,
    "credentials_secret_ref" TEXT NOT NULL,
    "sandbox" BOOLEAN NOT NULL,
    "status" "carrier_account_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_carrier_accounts" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_customer_shipping_rate_cards__public_id" ON "customer_shipping_rate_cards"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_customer_shipping_rate_cards__key" ON "customer_shipping_rate_cards"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ux_customer_shipping_rate_card_versions__public_id" ON "customer_shipping_rate_card_versions"("public_id");

-- CreateIndex
CREATE INDEX "ix_customer_shipping_rate_card_versions__resolution" ON "customer_shipping_rate_card_versions"("card_id", "effective_from" DESC, "version_no" DESC) WHERE (status = 'approved'::config_version_status);

-- CreateIndex
CREATE INDEX "ix_customer_shipping_rate_card_versions__scheme_id" ON "customer_shipping_rate_card_versions"("scheme_id");

-- CreateIndex
CREATE INDEX "ix_customer_shipping_rate_card_versions__approval_request_id" ON "customer_shipping_rate_card_versions"("approval_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_customer_shipping_rate_card_versions__card_id__version_no" ON "customer_shipping_rate_card_versions"("card_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_customer_shipping_rate_card_versions__id__scheme_id" ON "customer_shipping_rate_card_versions"("id", "scheme_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_customer_shipping_rate_card_versions__one_proposed" ON "customer_shipping_rate_card_versions"("card_id") WHERE (status = 'proposed'::config_version_status);

-- CreateIndex
CREATE INDEX "ix_customer_shipping_rates__version_id__scheme_id" ON "customer_shipping_rates"("version_id", "scheme_id");

-- CreateIndex
CREATE INDEX "ix_customer_shipping_rates__zone_id__scheme_id" ON "customer_shipping_rates"("zone_id", "scheme_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_factory_shipping_rate_cards__public_id" ON "factory_shipping_rate_cards"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_factory_shipping_rate_cards__factory_id" ON "factory_shipping_rate_cards"("factory_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_factory_shipping_rate_card_versions__public_id" ON "factory_shipping_rate_card_versions"("public_id");

-- CreateIndex
CREATE INDEX "ix_factory_shipping_rate_card_versions__resolution" ON "factory_shipping_rate_card_versions"("card_id", "effective_from" DESC, "version_no" DESC) WHERE (status = 'approved'::config_version_status);

-- CreateIndex
CREATE INDEX "ix_factory_shipping_rate_card_versions__scheme_id" ON "factory_shipping_rate_card_versions"("scheme_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_factory_shipping_rate_card_versions__card_id__version_no" ON "factory_shipping_rate_card_versions"("card_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_factory_shipping_rate_card_versions__id__scheme_id" ON "factory_shipping_rate_card_versions"("id", "scheme_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_factory_shipping_rate_card_versions__one_open" ON "factory_shipping_rate_card_versions"("card_id") WHERE (status = ANY (ARRAY['draft'::config_version_status, 'pending_acceptance'::config_version_status]));

-- CreateIndex
CREATE UNIQUE INDEX "ux_factory_shipping_rates__public_id" ON "factory_shipping_rates"("public_id");

-- CreateIndex
CREATE INDEX "ix_factory_shipping_rates__version_id__scheme_id" ON "factory_shipping_rates"("version_id", "scheme_id");

-- CreateIndex
CREATE INDEX "ix_factory_shipping_rates__zone_id__scheme_id" ON "factory_shipping_rates"("zone_id", "scheme_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_carriers__public_id" ON "carriers"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_carriers__code" ON "carriers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ux_carrier_accounts__public_id" ON "carrier_accounts"("public_id");

-- CreateIndex
CREATE INDEX "ix_carrier_accounts__entity_id__carrier_id" ON "carrier_accounts"("entity_id", "carrier_id");

-- CreateIndex
CREATE INDEX "ix_carrier_accounts__carrier_id" ON "carrier_accounts"("carrier_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_carrier_accounts__one_active" ON "carrier_accounts"("entity_id", "carrier_id", "sandbox") WHERE (status = 'active'::carrier_account_status);

-- AddForeignKey
ALTER TABLE "customer_shipping_rate_cards" ADD CONSTRAINT "fk_customer_shipping_rate_cards__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_shipping_rate_card_versions" ADD CONSTRAINT "fk_customer_shipping_rate_card_versions__card_id" FOREIGN KEY ("card_id") REFERENCES "customer_shipping_rate_cards"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_shipping_rate_card_versions" ADD CONSTRAINT "fk_customer_shipping_rate_card_versions__scheme_id" FOREIGN KEY ("scheme_id") REFERENCES "zone_schemes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_shipping_rate_card_versions" ADD CONSTRAINT "fk_customer_shipping_rate_card_versions__approval_request_id" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_shipping_rate_card_versions" ADD CONSTRAINT "fk_customer_shipping_rate_card_versions__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_shipping_rate_card_versions" ADD CONSTRAINT "fk_customer_shipping_rate_card_versions__decided_by" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_shipping_rates" ADD CONSTRAINT "fk_customer_shipping_rates__version_id__scheme_id" FOREIGN KEY ("version_id", "scheme_id") REFERENCES "customer_shipping_rate_card_versions"("id", "scheme_id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customer_shipping_rates" ADD CONSTRAINT "fk_customer_shipping_rates__zone_id__scheme_id" FOREIGN KEY ("zone_id", "scheme_id") REFERENCES "zones"("id", "scheme_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "factory_shipping_rate_cards" ADD CONSTRAINT "fk_factory_shipping_rate_cards__factory_id" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "factory_shipping_rate_cards" ADD CONSTRAINT "fk_factory_shipping_rate_cards__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "factory_shipping_rate_card_versions" ADD CONSTRAINT "fk_factory_shipping_rate_card_versions__card_id" FOREIGN KEY ("card_id") REFERENCES "factory_shipping_rate_cards"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "factory_shipping_rate_card_versions" ADD CONSTRAINT "fk_factory_shipping_rate_card_versions__scheme_id" FOREIGN KEY ("scheme_id") REFERENCES "zone_schemes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "factory_shipping_rate_card_versions" ADD CONSTRAINT "fk_factory_shipping_rate_card_versions__sent_by" FOREIGN KEY ("sent_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "factory_shipping_rate_card_versions" ADD CONSTRAINT "fk_factory_shipping_rate_card_versions__factory_accepted_by" FOREIGN KEY ("factory_accepted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "factory_shipping_rate_card_versions" ADD CONSTRAINT "fk_factory_shipping_rate_card_versions__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "factory_shipping_rate_card_versions" ADD CONSTRAINT "fk_factory_shipping_rate_card_versions__decided_by" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "factory_shipping_rates" ADD CONSTRAINT "fk_factory_shipping_rates__version_id__scheme_id" FOREIGN KEY ("version_id", "scheme_id") REFERENCES "factory_shipping_rate_card_versions"("id", "scheme_id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "factory_shipping_rates" ADD CONSTRAINT "fk_factory_shipping_rates__zone_id__scheme_id" FOREIGN KEY ("zone_id", "scheme_id") REFERENCES "zones"("id", "scheme_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "carriers" ADD CONSTRAINT "fk_carriers__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "carrier_accounts" ADD CONSTRAINT "fk_carrier_accounts__entity_id" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "carrier_accounts" ADD CONSTRAINT "fk_carrier_accounts__carrier_id" FOREIGN KEY ("carrier_id") REFERENCES "carriers"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "carrier_accounts" ADD CONSTRAINT "fk_carrier_accounts__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "carrier_accounts" ADD CONSTRAINT "fk_carrier_accounts__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- --- hand-written (Prisma cannot express these) --------------------------------------------------

-- --- customer shipping rate card (D-013) ----------------------------------------------------------
ALTER TABLE customer_shipping_rate_cards
  ADD CONSTRAINT ck_customer_shipping_rate_cards__key CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  ADD CONSTRAINT ck_customer_shipping_rate_cards__decision_refs CHECK (cardinality(decision_refs) >= 1);

ALTER TABLE customer_shipping_rate_card_versions
  ADD CONSTRAINT ck_customer_shipping_rate_card_versions__version_no CHECK (version_no > 0),
  ADD CONSTRAINT ck_customer_shipping_rate_card_versions__reason CHECK (btrim(reason) <> ''),
  ADD CONSTRAINT ck_customer_shipping_rate_card_versions__decided CHECK (status NOT IN ('approved', 'rejected') OR decided_at IS NOT NULL),
  ADD CONSTRAINT ck_customer_shipping_rate_card_versions__status CHECK (status <> 'pending_acceptance'),
  ADD CONSTRAINT ck_customer_shipping_rate_card_versions__approval CHECK (status <> 'proposed' OR approval_request_id IS NOT NULL);
CREATE TRIGGER tg_customer_shipping_rate_card_versions__immutable BEFORE UPDATE OR DELETE ON customer_shipping_rate_card_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_version_change();

ALTER TABLE customer_shipping_rates
  ADD CONSTRAINT ck_customer_shipping_rates__postcode CHECK (postcode IS NULL OR postcode ~ '^[0-9]{5}$'),
  ADD CONSTRAINT ck_customer_shipping_rates__weight CHECK (weight_min_g >= 0 AND (weight_max_g IS NULL OR weight_max_g > weight_min_g)),
  ADD CONSTRAINT ck_customer_shipping_rates__volume CHECK (
    (volume_min_cm3 IS NULL OR volume_min_cm3 >= 0) AND (volume_max_cm3 IS NULL OR volume_max_cm3 > COALESCE(volume_min_cm3, 0))
  ),
  ADD CONSTRAINT ck_customer_shipping_rates__amounts CHECK (price_amount >= 0 AND (per_extra_kg IS NULL OR per_extra_kg >= 0)),
  -- One rate per (zone or postcode, weight, volume) point: bands are half-open, null bounds open.
  ADD CONSTRAINT ex_customer_shipping_rates__no_overlap EXCLUDE USING gist (
    version_id WITH =,
    zone_id WITH =,
    (COALESCE(postcode, '')) WITH =,
    int8range(weight_min_g, weight_max_g, '[)') WITH &&,
    int8range(COALESCE(volume_min_cm3, 0), volume_max_cm3, '[)') WITH &&
  );

-- Rates are frozen with their version: writable only while it is a draft (a draft's deletion cascades).
CREATE FUNCTION forbid_decided_customer_shipping_rate_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  version_status config_version_status;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO version_status FROM customer_shipping_rate_card_versions WHERE id = OLD.version_id;
    IF version_status IS NOT NULL AND version_status <> 'draft' THEN
      RAISE EXCEPTION 'customer_shipping_rates row % belongs to a % version and cannot be changed', OLD.id, version_status
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO version_status FROM customer_shipping_rate_card_versions WHERE id = NEW.version_id;
    IF version_status IS NULL OR version_status <> 'draft' THEN
      RAISE EXCEPTION 'customer_shipping_rates rows can only be written to a draft version'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER tg_customer_shipping_rates__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON customer_shipping_rates
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_customer_shipping_rate_change();

-- --- factory shipping payout rate card (D-013, D-042) ---------------------------------------------
ALTER TABLE factory_shipping_rate_card_versions
  ADD CONSTRAINT ck_factory_shipping_rate_card_versions__version_no CHECK (version_no > 0),
  ADD CONSTRAINT ck_factory_shipping_rate_card_versions__reason CHECK (btrim(reason) <> ''),
  ADD CONSTRAINT ck_factory_shipping_rate_card_versions__decided CHECK (status NOT IN ('approved', 'rejected', 'withdrawn') OR decided_at IS NOT NULL),
  -- Packio drafts and the factory accepts; there is no approval-engine step.
  ADD CONSTRAINT ck_factory_shipping_rate_card_versions__status CHECK (status <> 'proposed'),
  ADD CONSTRAINT ck_factory_shipping_rate_card_versions__sent CHECK (status = 'draft' OR sent_at IS NOT NULL),
  -- D-042: a Packio-drafted card applies only once the factory has accepted it.
  ADD CONSTRAINT ck_factory_shipping_rate_card_versions__accepted CHECK (status <> 'approved' OR factory_accepted_at IS NOT NULL);
CREATE TRIGGER tg_factory_shipping_rate_card_versions__immutable BEFORE UPDATE OR DELETE ON factory_shipping_rate_card_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_version_change();

ALTER TABLE factory_shipping_rates
  ADD CONSTRAINT ck_factory_shipping_rates__postcode CHECK (postcode IS NULL OR postcode ~ '^[0-9]{5}$'),
  ADD CONSTRAINT ck_factory_shipping_rates__weight CHECK (weight_min_g >= 0 AND (weight_max_g IS NULL OR weight_max_g > weight_min_g)),
  ADD CONSTRAINT ck_factory_shipping_rates__volume CHECK (
    (volume_min_cm3 IS NULL OR volume_min_cm3 >= 0) AND (volume_max_cm3 IS NULL OR volume_max_cm3 > COALESCE(volume_min_cm3, 0))
  ),
  ADD CONSTRAINT ck_factory_shipping_rates__amounts CHECK (
    payout_amount >= 0 AND (per_extra_kg IS NULL OR per_extra_kg >= 0)
    AND (counter_amount IS NULL OR counter_amount >= 0) AND (counter_per_extra_kg IS NULL OR counter_per_extra_kg >= 0)
  ),
  ADD CONSTRAINT ck_factory_shipping_rates__counter CHECK (
    acceptance = 'countered' OR (counter_amount IS NULL AND counter_per_extra_kg IS NULL AND counter_note IS NULL)
  ),
  ADD CONSTRAINT ck_factory_shipping_rates__countered CHECK (acceptance <> 'countered' OR counter_amount IS NOT NULL),
  ADD CONSTRAINT ex_factory_shipping_rates__no_overlap EXCLUDE USING gist (
    version_id WITH =,
    zone_id WITH =,
    (COALESCE(postcode, '')) WITH =,
    int8range(weight_min_g, weight_max_g, '[)') WITH &&,
    int8range(COALESCE(volume_min_cm3, 0), volume_max_cm3, '[)') WITH &&
  );

-- Rates are writable while the version is a draft or awaits the factory (answers and counter
-- settlements), frozen once decided.
CREATE FUNCTION forbid_decided_factory_shipping_rate_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  version_status config_version_status;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO version_status FROM factory_shipping_rate_card_versions WHERE id = OLD.version_id;
    IF version_status IS NOT NULL AND version_status NOT IN ('draft', 'pending_acceptance') THEN
      RAISE EXCEPTION 'factory_shipping_rates row % belongs to a % version and cannot be changed', OLD.id, version_status
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO version_status FROM factory_shipping_rate_card_versions WHERE id = NEW.version_id;
    IF version_status IS NULL OR version_status <> 'draft' THEN
      RAISE EXCEPTION 'factory_shipping_rates rows can only be added to a draft version'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    RETURN NEW;
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER tg_factory_shipping_rates__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON factory_shipping_rates
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_factory_shipping_rate_change();

-- --- carriers (D-114) -----------------------------------------------------------------------------
ALTER TABLE carriers
  ADD CONSTRAINT ck_carriers__adapter_key CHECK (adapter_key ~ '^[a-z][a-z0-9_]*$'),
  ADD CONSTRAINT ck_carriers__name CHECK (btrim(name) <> '');

ALTER TABLE carrier_accounts
  ADD CONSTRAINT ck_carrier_accounts__label CHECK (btrim(label) <> ''),
  ADD CONSTRAINT ck_carrier_accounts__secret_ref CHECK (btrim(credentials_secret_ref) <> '');
