-- B6.1 Demand & growth analytics (D-102, D-044, D-160; schema-design §3.9, A-47). Hand-written: the `analytics`
-- Postgres schema is SQL-only (not in the Prisma schema, so `prisma migrate diff` ignores it) — raw events,
-- a star model (dimensions + daily facts rebuilt idempotently by `rollup_runs`) and the partner prospectus
-- exports. Facts are written by set-based SQL in `src/modules/analytics/rollups.sql.ts`; no customer
-- identity or individual price is stored in a fact (PDPA, D-102).
--
-- Prisma's database reset only drops the `public` objects, so this migration owns the whole schema: it is
-- recreated from scratch when applied (it never exists before this migration in a real database), and nothing in
-- it has a foreign key into `public` (a key would block the reset); the references to users and files are kept
-- by the service.

DROP SCHEMA IF EXISTS analytics CASCADE;
CREATE SCHEMA analytics;

CREATE TYPE analytics.analytics_source AS ENUM ('bff', 'outbox');
-- `not_applicable`: business events from the outbox, which never carry a visitor identifier.
CREATE TYPE analytics.consent_state AS ENUM ('granted', 'denied', 'not_applicable');

-- --- banding helpers (the SQL twins of src/modules/rfq/rfq-spec.ts; parity is tested) ------------------------

-- Quantity band (D-102): banded, never the exact figure.
CREATE FUNCTION analytics.quantity_band(q bigint) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN q IS NULL THEN 'unknown'
    WHEN q < 100 THEN '0-99'
    WHEN q < 500 THEN '100-499'
    WHEN q < 1000 THEN '500-999'
    WHEN q < 5000 THEN '1000-4999'
    WHEN q < 10000 THEN '5000-9999'
    WHEN q < 50000 THEN '10000-49999'
    ELSE '50000+'
  END
$$;

-- Dimensions rounded down to 50 mm bands (D-102 "spec band").
CREATE FUNCTION analytics.dimension_band(mm numeric) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT (floor(mm / 50) * 50)::integer
$$;

-- `W200-L300-H100`; `-` for a missing dimension; `none` when there is no dimension at all.
CREATE FUNCTION analytics.spec_band(w numeric, l numeric, h numeric) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN w IS NULL AND l IS NULL AND h IS NULL THEN 'none'
    ELSE 'W' || coalesce(analytics.dimension_band(w)::text, '-')
      || '-L' || coalesce(analytics.dimension_band(l)::text, '-')
      || '-H' || coalesce(analytics.dimension_band(h)::text, '-')
  END
$$;

-- Province of a postcode (a postcode can span subdistricts; they share a province in practice — lowest id wins).
CREATE FUNCTION analytics.province_of_postcode(p text) RETURNS bigint
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT d.province_id
  FROM public.geo_subdistricts s
  JOIN public.geo_districts d ON d.id = s.district_id
  WHERE s.postcode = p
  ORDER BY d.province_id
  LIMIT 1
$$;

-- Bangkok business date of an instant (business rules in Asia/Bangkok, CLAUDE.md).
CREATE FUNCTION analytics.bangkok_date(ts timestamptz) RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT (ts AT TIME ZONE 'Asia/Bangkok')::date
$$;

-- --- raw events -----------------------------------------------------------------------------------------------

-- Frontend events posted through the BFF (consent mode) and curated business events from the outbox. Without
-- analytics consent no identifier is kept (check); no IP is ever stored; `properties` are schema-validated by
-- the API (no PII). Partitioned monthly (schema-design §1.7).
CREATE TABLE analytics.raw_events (
    "event_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" analytics.analytics_source NOT NULL,
    "event_name" TEXT NOT NULL,
    "anonymous_id" TEXT,
    "session_id" TEXT,
    "user_public_id" UUID,
    "consent_state" analytics.consent_state NOT NULL,
    "page_path" TEXT,
    "product_type_code" TEXT,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "utm" JSONB,
    "device_class" TEXT,
    "province_code" TEXT,

    CONSTRAINT "pk_raw_events" PRIMARY KEY ("event_id", "occurred_at"),
    CONSTRAINT "ck_raw_events__identifiers" CHECK (
      consent_state = 'granted'
      OR (anonymous_id IS NULL AND session_id IS NULL AND user_public_id IS NULL AND province_code IS NULL)
    ),
    CONSTRAINT "ck_raw_events__source_consent" CHECK ((source = 'outbox') = (consent_state = 'not_applicable')),
    CONSTRAINT "ck_raw_events__properties" CHECK (jsonb_typeof(properties) = 'object'),
    CONSTRAINT "ck_raw_events__utm" CHECK (utm IS NULL OR jsonb_typeof(utm) = 'object'),
    CONSTRAINT "ck_raw_events__event_name" CHECK (event_name ~ '^[a-z][a-z0-9_.]{0,79}$'),
    CONSTRAINT "ck_raw_events__device_class" CHECK (device_class IS NULL OR device_class IN ('mobile', 'tablet', 'desktop', 'other'))
) PARTITION BY RANGE ("occurred_at");

CREATE INDEX "ix_raw_events__occurred_at__event_name" ON analytics.raw_events ("occurred_at", "event_name");
CREATE INDEX "ix_raw_events__session_id" ON analytics.raw_events ("session_id", "occurred_at") WHERE session_id IS NOT NULL;

CREATE TABLE partitions.raw_events_default PARTITION OF analytics.raw_events DEFAULT;
SELECT ensure_monthly_partitions('analytics.raw_events', DATE '2026-09-01', 13);

-- --- dimensions -----------------------------------------------------------------------------------------------

CREATE TABLE analytics.dim_date (
    "date_key" DATE NOT NULL,
    "year" SMALLINT NOT NULL,
    "quarter" SMALLINT NOT NULL,
    "month" SMALLINT NOT NULL,
    "iso_year" SMALLINT NOT NULL,
    "iso_week" SMALLINT NOT NULL,
    "iso_day_of_week" SMALLINT NOT NULL,
    "is_weekend" BOOLEAN NOT NULL,
    "week_start" DATE NOT NULL,
    "month_start" DATE NOT NULL,
    CONSTRAINT "pk_dim_date" PRIMARY KEY ("date_key")
);

CREATE TABLE analytics.dim_product_type (
    "product_type_id" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "category_code" TEXT,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "quote_mode" TEXT NOT NULL,
    "refreshed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pk_dim_product_type" PRIMARY KEY ("product_type_id")
);

CREATE TABLE analytics.dim_province (
    "province_id" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "region" TEXT,
    "refreshed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pk_dim_province" PRIMARY KEY ("province_id")
);

CREATE TABLE analytics.dim_quantity_band (
    "code" TEXT NOT NULL,
    "lower_bound" INTEGER,
    "upper_bound" INTEGER,
    "sort" SMALLINT NOT NULL,
    CONSTRAINT "pk_dim_quantity_band" PRIMARY KEY ("code")
);
-- Analytics buckets from B2.5 (PROGRESS B2.5 assumption 8: adjustable); `unknown` when no quantity is known.
INSERT INTO analytics.dim_quantity_band ("code", "lower_bound", "upper_bound", "sort") VALUES
  ('0-99', 0, 99, 1), ('100-499', 100, 499, 2), ('500-999', 500, 999, 3), ('1000-4999', 1000, 4999, 4),
  ('5000-9999', 5000, 9999, 5), ('10000-49999', 10000, 49999, 6), ('50000+', 50000, NULL, 7), ('unknown', NULL, NULL, 99);

CREATE TABLE analytics.dim_spec_band (
    "code" TEXT NOT NULL,
    "width_band" INTEGER,
    "length_band" INTEGER,
    "height_band" INTEGER,
    CONSTRAINT "pk_dim_spec_band" PRIMARY KEY ("code")
);
INSERT INTO analytics.dim_spec_band ("code") VALUES ('none');

CREATE TABLE analytics.dim_channel (
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    CONSTRAINT "pk_dim_channel" PRIMARY KEY ("code")
);
INSERT INTO analytics.dim_channel ("code", "name_th", "name_en") VALUES
  ('web', 'เว็บไซต์', 'Web'), ('cs', 'ฝ่ายบริการลูกค้า', 'Customer service'), ('line', 'LINE', 'LINE'),
  ('b2b', 'ลูกค้าองค์กร', 'B2B'), ('unknown', 'ไม่ทราบ', 'Unknown');

CREATE TABLE analytics.dim_campaign (
    "campaign_id" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6),
    "refreshed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pk_dim_campaign" PRIMARY KEY ("campaign_id")
);

-- No identity: new (first order group), returning, B2B company order.
CREATE TABLE analytics.dim_customer_segment (
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    CONSTRAINT "pk_dim_customer_segment" PRIMARY KEY ("code")
);
INSERT INTO analytics.dim_customer_segment ("code", "name_th", "name_en") VALUES
  ('new', 'ลูกค้าใหม่', 'New'), ('returning', 'ลูกค้าเดิม', 'Returning'), ('b2b', 'ลูกค้าองค์กร', 'B2B');

-- Staff-only reports (D-044): factory identities never reach the prospectus.
CREATE TABLE analytics.dim_factory (
    "factory_id" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "trade_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "refreshed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pk_dim_factory" PRIMARY KEY ("factory_id")
);

-- --- facts (daily grain; each rollup replaces the rows of its date) ------------------------------------------

-- Consented sessions (split at Bangkok midnight) and page views; unconsented hits count page views only.
CREATE TABLE analytics.fact_sessions (
    "date_key" DATE NOT NULL,
    "device_class" TEXT NOT NULL,
    "utm_source" TEXT NOT NULL,
    "utm_medium" TEXT NOT NULL,
    "utm_campaign" TEXT NOT NULL,
    "consent_state" analytics.consent_state NOT NULL,
    "sessions" INTEGER NOT NULL,
    "visitors" INTEGER NOT NULL,
    "page_views" INTEGER NOT NULL,
    "events" INTEGER NOT NULL,
    CONSTRAINT "pk_fact_sessions" PRIMARY KEY ("date_key", "device_class", "utm_source", "utm_medium", "utm_campaign", "consent_state"),
    CONSTRAINT "fk_fact_sessions__date_key" FOREIGN KEY ("date_key") REFERENCES analytics.dim_date ("date_key")
);

-- Session funnel visit → configure → quote → cart → checkout → placed → paid; `product_type_id` 0 = all types.
CREATE TABLE analytics.fact_funnel (
    "date_key" DATE NOT NULL,
    "product_type_id" BIGINT NOT NULL,
    "visits" INTEGER NOT NULL,
    "configured" INTEGER NOT NULL,
    "quoted" INTEGER NOT NULL,
    "carted" INTEGER NOT NULL,
    "checkout_started" INTEGER NOT NULL,
    "placed" INTEGER NOT NULL,
    "paid" INTEGER NOT NULL,
    CONSTRAINT "pk_fact_funnel" PRIMARY KEY ("date_key", "product_type_id"),
    CONSTRAINT "fk_fact_funnel__date_key" FOREIGN KEY ("date_key") REFERENCES analytics.dim_date ("date_key")
);

-- Calculations (every price shown), saved and converted quotations.
CREATE TABLE analytics.fact_quotes (
    "date_key" DATE NOT NULL,
    "product_type_id" BIGINT NOT NULL,
    "spec_band" TEXT NOT NULL,
    "quantity_band" TEXT NOT NULL,
    "province_id" BIGINT NOT NULL DEFAULT 0,
    "channel" TEXT NOT NULL,
    "calculations" INTEGER NOT NULL,
    "instant_calculations" INTEGER NOT NULL,
    "routed_to_rfq" INTEGER NOT NULL,
    "saved_quotes" INTEGER NOT NULL,
    "converted_quotes" INTEGER NOT NULL,
    CONSTRAINT "pk_fact_quotes" PRIMARY KEY ("date_key", "product_type_id", "spec_band", "quantity_band", "province_id", "channel"),
    CONSTRAINT "fk_fact_quotes__date_key" FOREIGN KEY ("date_key") REFERENCES analytics.dim_date ("date_key"),
    CONSTRAINT "fk_fact_quotes__product_type_id" FOREIGN KEY ("product_type_id") REFERENCES analytics.dim_product_type ("product_type_id"),
    CONSTRAINT "fk_fact_quotes__spec_band" FOREIGN KEY ("spec_band") REFERENCES analytics.dim_spec_band ("code"),
    CONSTRAINT "fk_fact_quotes__quantity_band" FOREIGN KEY ("quantity_band") REFERENCES analytics.dim_quantity_band ("code"),
    CONSTRAINT "fk_fact_quotes__channel" FOREIGN KEY ("channel") REFERENCES analytics.dim_channel ("code")
);

-- RFQs: each measure on the day its event happened (submitted, first response, first quotation, closed).
CREATE TABLE analytics.fact_rfqs (
    "date_key" DATE NOT NULL,
    "product_type_id" BIGINT NOT NULL,
    "spec_band" TEXT NOT NULL,
    "quantity_band" TEXT NOT NULL,
    "province_id" BIGINT NOT NULL DEFAULT 0,
    "channel" TEXT NOT NULL,
    "submitted" INTEGER NOT NULL,
    "first_responses" INTEGER NOT NULL,
    "first_response_minutes" BIGINT NOT NULL,
    "quoted" INTEGER NOT NULL,
    "accepted" INTEGER NOT NULL,
    "declined" INTEGER NOT NULL,
    "expired" INTEGER NOT NULL,
    CONSTRAINT "pk_fact_rfqs" PRIMARY KEY ("date_key", "product_type_id", "spec_band", "quantity_band", "province_id", "channel"),
    CONSTRAINT "fk_fact_rfqs__date_key" FOREIGN KEY ("date_key") REFERENCES analytics.dim_date ("date_key"),
    CONSTRAINT "fk_fact_rfqs__product_type_id" FOREIGN KEY ("product_type_id") REFERENCES analytics.dim_product_type ("product_type_id"),
    CONSTRAINT "fk_fact_rfqs__spec_band" FOREIGN KEY ("spec_band") REFERENCES analytics.dim_spec_band ("code"),
    CONSTRAINT "fk_fact_rfqs__quantity_band" FOREIGN KEY ("quantity_band") REFERENCES analytics.dim_quantity_band ("code"),
    CONSTRAINT "fk_fact_rfqs__channel" FOREIGN KEY ("channel") REFERENCES analytics.dim_channel ("code")
);

-- Order groups by the day they were placed (GMV, AOV, repeat-rate inputs). `paid` = in progress or completed
-- (paid, or confirmed on B2B credit); money is THB, `net` = gross − VAT.
CREATE TABLE analytics.fact_orders (
    "date_key" DATE NOT NULL,
    "channel" TEXT NOT NULL,
    "customer_segment" TEXT NOT NULL,
    "province_id" BIGINT NOT NULL DEFAULT 0,
    "groups_placed" INTEGER NOT NULL,
    "groups_paid" INTEGER NOT NULL,
    "groups_cancelled" INTEGER NOT NULL,
    "orders_paid" INTEGER NOT NULL,
    "gross_paid" NUMERIC(14,2) NOT NULL,
    "net_paid" NUMERIC(14,2) NOT NULL,
    "discount_paid" NUMERIC(14,2) NOT NULL,
    CONSTRAINT "pk_fact_orders" PRIMARY KEY ("date_key", "channel", "customer_segment", "province_id"),
    CONSTRAINT "fk_fact_orders__date_key" FOREIGN KEY ("date_key") REFERENCES analytics.dim_date ("date_key"),
    CONSTRAINT "fk_fact_orders__channel" FOREIGN KEY ("channel") REFERENCES analytics.dim_channel ("code"),
    CONSTRAINT "fk_fact_orders__customer_segment" FOREIGN KEY ("customer_segment") REFERENCES analytics.dim_customer_segment ("code")
);

-- Orders (one per configuration) by product type and quantity band, by the day their group was placed.
CREATE TABLE analytics.fact_order_items (
    "date_key" DATE NOT NULL,
    "product_type_id" BIGINT NOT NULL,
    "quantity_band" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "orders_placed" INTEGER NOT NULL,
    "orders_paid" INTEGER NOT NULL,
    "quantity_paid" BIGINT NOT NULL,
    "gross_paid" NUMERIC(14,2) NOT NULL,
    "net_paid" NUMERIC(14,2) NOT NULL,
    CONSTRAINT "pk_fact_order_items" PRIMARY KEY ("date_key", "product_type_id", "quantity_band", "channel"),
    CONSTRAINT "fk_fact_order_items__date_key" FOREIGN KEY ("date_key") REFERENCES analytics.dim_date ("date_key"),
    CONSTRAINT "fk_fact_order_items__product_type_id" FOREIGN KEY ("product_type_id") REFERENCES analytics.dim_product_type ("product_type_id"),
    CONSTRAINT "fk_fact_order_items__quantity_band" FOREIGN KEY ("quantity_band") REFERENCES analytics.dim_quantity_band ("code"),
    CONSTRAINT "fk_fact_order_items__channel" FOREIGN KEY ("channel") REFERENCES analytics.dim_channel ("code")
);

-- Successful payments by the day they were paid.
CREATE TABLE analytics.fact_payments (
    "date_key" DATE NOT NULL,
    "method" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "payments" INTEGER NOT NULL,
    "amount" NUMERIC(14,2) NOT NULL,
    "fee" NUMERIC(14,2) NOT NULL,
    "wht" NUMERIC(14,2) NOT NULL,
    "cash" NUMERIC(14,2) NOT NULL,
    "refunded" NUMERIC(14,2) NOT NULL,
    CONSTRAINT "pk_fact_payments" PRIMARY KEY ("date_key", "method", "provider", "channel"),
    CONSTRAINT "fk_fact_payments__date_key" FOREIGN KEY ("date_key") REFERENCES analytics.dim_date ("date_key"),
    CONSTRAINT "fk_fact_payments__channel" FOREIGN KEY ("channel") REFERENCES analytics.dim_channel ("code")
);

-- Production jobs per factory (staff-only, D-044): acceptance on time (D-074), shipping against the promise.
CREATE TABLE analytics.fact_jobs (
    "date_key" DATE NOT NULL,
    "factory_id" BIGINT NOT NULL,
    "product_type_id" BIGINT NOT NULL,
    "released" INTEGER NOT NULL,
    "accepted" INTEGER NOT NULL,
    "accepted_on_time" INTEGER NOT NULL,
    "rejected" INTEGER NOT NULL,
    "finished" INTEGER NOT NULL,
    "shipped" INTEGER NOT NULL,
    "shipped_with_promise" INTEGER NOT NULL,
    "shipped_on_time" INTEGER NOT NULL,
    CONSTRAINT "pk_fact_jobs" PRIMARY KEY ("date_key", "factory_id", "product_type_id"),
    CONSTRAINT "fk_fact_jobs__date_key" FOREIGN KEY ("date_key") REFERENCES analytics.dim_date ("date_key"),
    CONSTRAINT "fk_fact_jobs__factory_id" FOREIGN KEY ("factory_id") REFERENCES analytics.dim_factory ("factory_id"),
    CONSTRAINT "fk_fact_jobs__product_type_id" FOREIGN KEY ("product_type_id") REFERENCES analytics.dim_product_type ("product_type_id")
);

CREATE TABLE analytics.fact_shipments (
    "date_key" DATE NOT NULL,
    "factory_id" BIGINT NOT NULL,
    "carrier_code" TEXT NOT NULL,
    "province_id" BIGINT NOT NULL DEFAULT 0,
    "picked_up" INTEGER NOT NULL,
    "picked_up_with_plan" INTEGER NOT NULL,
    "picked_up_on_time" INTEGER NOT NULL,
    "delivered" INTEGER NOT NULL,
    CONSTRAINT "pk_fact_shipments" PRIMARY KEY ("date_key", "factory_id", "carrier_code", "province_id"),
    CONSTRAINT "fk_fact_shipments__date_key" FOREIGN KEY ("date_key") REFERENCES analytics.dim_date ("date_key"),
    CONSTRAINT "fk_fact_shipments__factory_id" FOREIGN KEY ("factory_id") REFERENCES analytics.dim_factory ("factory_id")
);

-- `factory_id` 0 = no factory liable (yet).
CREATE TABLE analytics.fact_claims (
    "date_key" DATE NOT NULL,
    "product_type_id" BIGINT NOT NULL,
    "factory_id" BIGINT NOT NULL DEFAULT 0,
    "claim_type" TEXT NOT NULL,
    "liability" TEXT NOT NULL,
    "submitted" INTEGER NOT NULL,
    "claimed_amount" NUMERIC(14,2) NOT NULL,
    "decided" INTEGER NOT NULL,
    "resolved" INTEGER NOT NULL,
    CONSTRAINT "pk_fact_claims" PRIMARY KEY ("date_key", "product_type_id", "factory_id", "claim_type", "liability"),
    CONSTRAINT "fk_fact_claims__date_key" FOREIGN KEY ("date_key") REFERENCES analytics.dim_date ("date_key"),
    CONSTRAINT "fk_fact_claims__product_type_id" FOREIGN KEY ("product_type_id") REFERENCES analytics.dim_product_type ("product_type_id")
);

-- Demand Packio could not serve (from `unmet_demand_records`, D-102).
CREATE TABLE analytics.fact_unmet_demand (
    "date_key" DATE NOT NULL,
    "product_type_id" BIGINT NOT NULL,
    "source" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "spec_band" TEXT NOT NULL,
    "quantity_band" TEXT NOT NULL,
    "province_id" BIGINT NOT NULL DEFAULT 0,
    "records" INTEGER NOT NULL,
    CONSTRAINT "pk_fact_unmet_demand" PRIMARY KEY ("date_key", "product_type_id", "source", "reason_code", "spec_band", "quantity_band", "province_id"),
    CONSTRAINT "fk_fact_unmet_demand__date_key" FOREIGN KEY ("date_key") REFERENCES analytics.dim_date ("date_key"),
    CONSTRAINT "fk_fact_unmet_demand__product_type_id" FOREIGN KEY ("product_type_id") REFERENCES analytics.dim_product_type ("product_type_id"),
    CONSTRAINT "fk_fact_unmet_demand__spec_band" FOREIGN KEY ("spec_band") REFERENCES analytics.dim_spec_band ("code"),
    CONSTRAINT "fk_fact_unmet_demand__quantity_band" FOREIGN KEY ("quantity_band") REFERENCES analytics.dim_quantity_band ("code")
);

-- Campaign performance (D-053, D-154): redemptions applied / reversed per day.
CREATE TABLE analytics.fact_campaigns (
    "date_key" DATE NOT NULL,
    "campaign_id" BIGINT NOT NULL,
    "redemptions" INTEGER NOT NULL,
    "reversals" INTEGER NOT NULL,
    "discount_amount" NUMERIC(14,2) NOT NULL,
    "capped_amount" NUMERIC(14,2) NOT NULL,
    "order_groups" INTEGER NOT NULL,
    "gross_amount" NUMERIC(14,2) NOT NULL,
    "new_customers" INTEGER NOT NULL,
    CONSTRAINT "pk_fact_campaigns" PRIMARY KEY ("date_key", "campaign_id"),
    CONSTRAINT "fk_fact_campaigns__date_key" FOREIGN KEY ("date_key") REFERENCES analytics.dim_date ("date_key"),
    CONSTRAINT "fk_fact_campaigns__campaign_id" FOREIGN KEY ("campaign_id") REFERENCES analytics.dim_campaign ("campaign_id")
);

-- --- rollup runs & prospectus exports -------------------------------------------------------------------------

-- One row per (job, date): the nightly rollup and admin backfills (`queued` rows are picked up by the worker).
CREATE TABLE analytics.rollup_runs (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "job" TEXT NOT NULL,
    "for_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "row_count" INTEGER,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "requested_by" BIGINT,
    "queued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    CONSTRAINT "pk_rollup_runs" PRIMARY KEY ("id"),
    CONSTRAINT "ux_rollup_runs__job__for_date" UNIQUE ("job", "for_date"),
    CONSTRAINT "ck_rollup_runs__status" CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
    CONSTRAINT "ck_rollup_runs__finished" CHECK (status NOT IN ('succeeded', 'failed') OR finished_at IS NOT NULL)
);
CREATE INDEX "ix_rollup_runs__status" ON analytics.rollup_runs ("status", "queued_at") WHERE status IN ('queued', 'running');
CREATE INDEX "ix_rollup_runs__requested_by" ON analytics.rollup_runs ("requested_by");

-- Partner prospectus (D-102, D-044, D-160): aggregated, anonymised, every cell backed by ≥ k contributors.
CREATE TABLE analytics.prospectus_exports (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "k_threshold" SMALLINT NOT NULL,
    "suppressed_cells" INTEGER,
    "pdf_file_id" BIGINT,
    "pdf_sha256" BYTEA,
    "xlsx_file_id" BIGINT,
    "xlsx_sha256" BYTEA,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "generated_by" BIGINT NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated_at" TIMESTAMPTZ(6),
    CONSTRAINT "pk_prospectus_exports" PRIMARY KEY ("id"),
    CONSTRAINT "ux_prospectus_exports__public_id" UNIQUE ("public_id"),
    CONSTRAINT "ck_prospectus_exports__status" CHECK (status IN ('pending', 'ready', 'failed')),
    CONSTRAINT "ck_prospectus_exports__period" CHECK (period_from <= period_to),
    CONSTRAINT "ck_prospectus_exports__k" CHECK (k_threshold >= 2),
    CONSTRAINT "ck_prospectus_exports__ready" CHECK (
      status <> 'ready' OR (pdf_file_id IS NOT NULL AND xlsx_file_id IS NOT NULL AND generated_at IS NOT NULL AND suppressed_cells IS NOT NULL)
    )
);
CREATE INDEX "ix_prospectus_exports__pending" ON analytics.prospectus_exports ("requested_at") WHERE status = 'pending';
CREATE INDEX "ix_prospectus_exports__pdf_file_id" ON analytics.prospectus_exports ("pdf_file_id");
CREATE INDEX "ix_prospectus_exports__xlsx_file_id" ON analytics.prospectus_exports ("xlsx_file_id");
CREATE INDEX "ix_prospectus_exports__generated_by" ON analytics.prospectus_exports ("generated_by");
