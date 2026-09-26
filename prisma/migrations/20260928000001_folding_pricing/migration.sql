-- B2.3 folding pricing, shared part (schema-design §3.5 / §3.8): Packio's sell margins (D-063), the
-- statutory tax rates migrated early for the VAT snapshot (§7 A-22), and the calculate / search logs
-- (analytics, B6). The folding `pl_*` components arrive with the engine slices that read them.

-- CreateEnum
CREATE TYPE "sell_margin_kind" AS ENUM ('margin', 'design_fee', 'structure_design_fee', 'fix_cost', 'target_margin');

-- CreateEnum
CREATE TYPE "sales_channel" AS ENUM ('web', 'cs', 'line', 'b2b');

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "decision_refs" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,

    CONSTRAINT "pk_tax_rates" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rate_versions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "tax_rate_id" BIGINT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "status" "config_version_status" NOT NULL DEFAULT 'draft',
    "rate_pct" DECIMAL(7,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "approval_request_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" BIGINT,

    CONSTRAINT "pk_tax_rate_versions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sell_margin_tables" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "product_type_id" BIGINT NOT NULL,
    "print_type_id" BIGINT,
    "kind" "sell_margin_kind" NOT NULL,
    "description" TEXT NOT NULL,
    "decision_refs" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,

    CONSTRAINT "pk_sell_margin_tables" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sell_margin_table_versions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "table_id" BIGINT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "status" "config_version_status" NOT NULL DEFAULT 'draft',
    "fallback_pct" DECIMAL(7,4),
    "fallback_amount" DECIMAL(18,6),
    "reason" TEXT NOT NULL,
    "approval_request_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" BIGINT,

    CONSTRAINT "pk_sell_margin_table_versions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sell_margin_lines" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "version_id" BIGINT NOT NULL,
    "qty_min" INTEGER,
    "qty_max" INTEGER,
    "price_min" DECIMAL(18,6),
    "price_max" DECIMAL(18,6),
    "colour_count" SMALLINT,
    "difficulty_level_id" BIGINT,
    "value_pct" DECIMAL(7,4),
    "value_amount" DECIMAL(18,6),
    "min_amount" DECIMAL(18,6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_sell_margin_lines" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calculate_logs" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" "sales_channel" NOT NULL,
    "product_type_id" BIGINT NOT NULL,
    "catalog_product_id" BIGINT,
    "stock_product_id" BIGINT,
    "actor_user_id" BIGINT,
    "anonymous_id" TEXT,
    "quantities" INTEGER[],
    "length_mm" DECIMAL(10,2),
    "width_mm" DECIMAL(10,2),
    "height_mm" DECIMAL(10,2),
    "delivery_postcode" CHAR(5),
    "promotion_code" TEXT,
    "input" JSONB NOT NULL,
    "input_schema_version" SMALLINT NOT NULL,
    "result_summary" JSONB NOT NULL,
    "calculator_version" TEXT,
    "instant_path" BOOLEAN NOT NULL,
    "routed_to_rfq" BOOLEAN NOT NULL,
    "quote_id" BIGINT,
    "duration_ms" INTEGER NOT NULL,
    "ip_prefix" INET,

    CONSTRAINT "pk_calculate_logs" PRIMARY KEY ("id","occurred_at")
) PARTITION BY RANGE ("occurred_at");

-- CreateTable
CREATE TABLE "search_logs" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "keyword" TEXT NOT NULL,
    "results_count" INTEGER NOT NULL,
    "channel" "sales_channel" NOT NULL,
    "actor_user_id" BIGINT,
    "anonymous_id" TEXT,

    CONSTRAINT "pk_search_logs" PRIMARY KEY ("id","occurred_at")
) PARTITION BY RANGE ("occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "ux_tax_rates__public_id" ON "tax_rates"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_tax_rates__code" ON "tax_rates"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ux_tax_rate_versions__public_id" ON "tax_rate_versions"("public_id");

-- CreateIndex
CREATE INDEX "ix_tax_rate_versions__resolution" ON "tax_rate_versions"("tax_rate_id", "effective_from" DESC, "version_no" DESC) WHERE (status = 'approved'::config_version_status);

-- CreateIndex
CREATE INDEX "ix_tax_rate_versions__approval_request_id" ON "tax_rate_versions"("approval_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_tax_rate_versions__tax_rate_id__version_no" ON "tax_rate_versions"("tax_rate_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sell_margin_tables__public_id" ON "sell_margin_tables"("public_id");

-- CreateIndex
CREATE INDEX "ix_sell_margin_tables__product_type_id" ON "sell_margin_tables"("product_type_id");

-- CreateIndex
CREATE INDEX "ix_sell_margin_tables__print_type_id" ON "sell_margin_tables"("print_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sell_margin_table_versions__public_id" ON "sell_margin_table_versions"("public_id");

-- CreateIndex
CREATE INDEX "ix_sell_margin_table_versions__resolution" ON "sell_margin_table_versions"("table_id", "effective_from" DESC, "version_no" DESC) WHERE (status = 'approved'::config_version_status);

-- CreateIndex
CREATE INDEX "ix_sell_margin_table_versions__approval_request_id" ON "sell_margin_table_versions"("approval_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sell_margin_table_versions__table_id__version_no" ON "sell_margin_table_versions"("table_id", "version_no");

-- CreateIndex
CREATE INDEX "ix_sell_margin_lines__version_id" ON "sell_margin_lines"("version_id");

-- CreateIndex
CREATE INDEX "ix_sell_margin_lines__difficulty_level_id" ON "sell_margin_lines"("difficulty_level_id");

-- CreateIndex
CREATE INDEX "ix_calculate_logs__product_type_id__occurred_at" ON "calculate_logs"("product_type_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ix_calculate_logs__catalog_product_id" ON "calculate_logs"("catalog_product_id");

-- CreateIndex
CREATE INDEX "ix_calculate_logs__stock_product_id" ON "calculate_logs"("stock_product_id");

-- CreateIndex
CREATE INDEX "ix_calculate_logs__actor_user_id__occurred_at" ON "calculate_logs"("actor_user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ix_search_logs__actor_user_id__occurred_at" ON "search_logs"("actor_user_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "fk_tax_rates__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tax_rate_versions" ADD CONSTRAINT "fk_tax_rate_versions__tax_rate_id" FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rates"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tax_rate_versions" ADD CONSTRAINT "fk_tax_rate_versions__approval_request_id" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tax_rate_versions" ADD CONSTRAINT "fk_tax_rate_versions__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tax_rate_versions" ADD CONSTRAINT "fk_tax_rate_versions__decided_by" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sell_margin_tables" ADD CONSTRAINT "fk_sell_margin_tables__product_type_id" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sell_margin_tables" ADD CONSTRAINT "fk_sell_margin_tables__print_type_id" FOREIGN KEY ("print_type_id") REFERENCES "print_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sell_margin_tables" ADD CONSTRAINT "fk_sell_margin_tables__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sell_margin_table_versions" ADD CONSTRAINT "fk_sell_margin_table_versions__table_id" FOREIGN KEY ("table_id") REFERENCES "sell_margin_tables"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sell_margin_table_versions" ADD CONSTRAINT "fk_sell_margin_table_versions__approval_request_id" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sell_margin_table_versions" ADD CONSTRAINT "fk_sell_margin_table_versions__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sell_margin_table_versions" ADD CONSTRAINT "fk_sell_margin_table_versions__decided_by" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sell_margin_lines" ADD CONSTRAINT "fk_sell_margin_lines__version_id" FOREIGN KEY ("version_id") REFERENCES "sell_margin_table_versions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sell_margin_lines" ADD CONSTRAINT "fk_sell_margin_lines__difficulty_level_id" FOREIGN KEY ("difficulty_level_id") REFERENCES "difficulty_levels"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "calculate_logs" ADD CONSTRAINT "fk_calculate_logs__product_type_id" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "calculate_logs" ADD CONSTRAINT "fk_calculate_logs__catalog_product_id" FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "calculate_logs" ADD CONSTRAINT "fk_calculate_logs__stock_product_id" FOREIGN KEY ("stock_product_id") REFERENCES "stock_products"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "calculate_logs" ADD CONSTRAINT "fk_calculate_logs__actor_user_id" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "search_logs" ADD CONSTRAINT "fk_search_logs__actor_user_id" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- --- hand-written (Prisma cannot express these) --------------------------------------------------

-- Exclusion constraints on bands need `=` on bigint inside a GiST index.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- --- tax rates (schema-design §3.8, A-22) ---------------------------------------------------------
ALTER TABLE tax_rates
  ADD CONSTRAINT ck_tax_rates__code CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  ADD CONSTRAINT ck_tax_rates__decision_refs CHECK (cardinality(decision_refs) >= 1);

ALTER TABLE tax_rate_versions
  ADD CONSTRAINT ck_tax_rate_versions__version_no CHECK (version_no > 0),
  ADD CONSTRAINT ck_tax_rate_versions__reason CHECK (btrim(reason) <> ''),
  ADD CONSTRAINT ck_tax_rate_versions__decided CHECK (status NOT IN ('approved', 'rejected') OR decided_at IS NOT NULL),
  ADD CONSTRAINT ck_tax_rate_versions__status CHECK (status <> 'pending_acceptance'),
  ADD CONSTRAINT ck_tax_rate_versions__rate_pct CHECK (rate_pct >= 0 AND rate_pct <= 100);
CREATE TRIGGER tg_tax_rate_versions__immutable BEFORE UPDATE OR DELETE ON tax_rate_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_version_change();

-- --- sell margins (D-063) -------------------------------------------------------------------------
CREATE UNIQUE INDEX ux_sell_margin_tables__scope ON sell_margin_tables (product_type_id, COALESCE(print_type_id, 0), kind);
ALTER TABLE sell_margin_tables
  ADD CONSTRAINT ck_sell_margin_tables__decision_refs CHECK (cardinality(decision_refs) >= 1);

-- A print-type-specific table must belong to a print type of the same product type.
CREATE FUNCTION check_sell_margin_table_print_type() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.print_type_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM print_types WHERE id = NEW.print_type_id AND product_type_id = NEW.product_type_id
  ) THEN
    RAISE EXCEPTION 'print type % does not belong to product type %', NEW.print_type_id, NEW.product_type_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_sell_margin_tables__print_type BEFORE INSERT OR UPDATE ON sell_margin_tables
  FOR EACH ROW EXECUTE FUNCTION check_sell_margin_table_print_type();

ALTER TABLE sell_margin_table_versions
  ADD CONSTRAINT ck_sell_margin_table_versions__version_no CHECK (version_no > 0),
  ADD CONSTRAINT ck_sell_margin_table_versions__reason CHECK (btrim(reason) <> ''),
  ADD CONSTRAINT ck_sell_margin_table_versions__decided CHECK (status NOT IN ('approved', 'rejected') OR decided_at IS NOT NULL),
  ADD CONSTRAINT ck_sell_margin_table_versions__status CHECK (status <> 'pending_acceptance'),
  -- A margin divides by (1 − pct / 100), so 100 % is refused.
  ADD CONSTRAINT ck_sell_margin_table_versions__fallback CHECK (
    (fallback_pct IS NULL OR (fallback_pct >= 0 AND fallback_pct < 100)) AND (fallback_amount IS NULL OR fallback_amount >= 0)
  );
CREATE TRIGGER tg_sell_margin_table_versions__immutable BEFORE UPDATE OR DELETE ON sell_margin_table_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_version_change();

ALTER TABLE sell_margin_lines
  ADD CONSTRAINT ck_sell_margin_lines__qty CHECK ((qty_min IS NULL OR qty_min >= 0) AND (qty_max IS NULL OR qty_max >= COALESCE(qty_min, 0))),
  ADD CONSTRAINT ck_sell_margin_lines__price CHECK ((price_min IS NULL OR price_min >= 0) AND (price_max IS NULL OR price_max > COALESCE(price_min, 0))),
  ADD CONSTRAINT ck_sell_margin_lines__colour_count CHECK (colour_count IS NULL OR colour_count >= 0),
  ADD CONSTRAINT ck_sell_margin_lines__value CHECK (num_nonnulls(value_pct, value_amount) = 1),
  ADD CONSTRAINT ck_sell_margin_lines__value_pct CHECK (value_pct IS NULL OR (value_pct >= 0 AND value_pct < 100)),
  ADD CONSTRAINT ck_sell_margin_lines__amounts CHECK ((value_amount IS NULL OR value_amount >= 0) AND (min_amount IS NULL OR min_amount >= 0)),
  -- One line per point: quantity bands inclusive, price bands half-open (legacy `FoldingCalculator.php:1419-1427`).
  ADD CONSTRAINT ex_sell_margin_lines__no_overlap EXCLUDE USING gist (
    version_id WITH =,
    (COALESCE(difficulty_level_id, 0)) WITH =,
    (COALESCE(colour_count, -1)) WITH =,
    int4range(qty_min, qty_max, '[]') WITH &&,
    numrange(price_min, price_max, '[)') WITH &&
  );

-- Lines are frozen with their version (copy-on-write, like the `pl_*` components): writable only while
-- the version is a draft; a draft's deletion cascades.
CREATE FUNCTION forbid_decided_sell_margin_line_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  version_status config_version_status;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO version_status FROM sell_margin_table_versions WHERE id = OLD.version_id;
    -- NULL: the version itself is being deleted (drafts only, cascade).
    IF version_status IS NOT NULL AND version_status <> 'draft' THEN
      RAISE EXCEPTION 'sell_margin_lines row % belongs to a % version and cannot be changed', OLD.id, version_status
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO version_status FROM sell_margin_table_versions WHERE id = NEW.version_id;
    IF version_status IS NULL OR version_status <> 'draft' THEN
      RAISE EXCEPTION 'sell_margin_lines rows can only be written to a draft version'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER tg_sell_margin_lines__version_frozen BEFORE INSERT OR UPDATE OR DELETE ON sell_margin_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_sell_margin_line_change();

-- --- calculate / search logs (schema-design §1.7, §3.5) -------------------------------------------
CREATE TABLE partitions.calculate_logs_default PARTITION OF calculate_logs DEFAULT;
CREATE TABLE partitions.search_logs_default PARTITION OF search_logs DEFAULT;
SELECT ensure_monthly_partitions('calculate_logs', DATE '2026-09-01', 13);
SELECT ensure_monthly_partitions('search_logs', DATE '2026-09-01', 13);

ALTER TABLE calculate_logs
  ADD CONSTRAINT ck_calculate_logs__quantities CHECK (quantities IS NOT NULL AND cardinality(quantities) >= 1 AND 0 < ALL (quantities)),
  ADD CONSTRAINT ck_calculate_logs__input_schema_version CHECK (input_schema_version > 0),
  ADD CONSTRAINT ck_calculate_logs__duration_ms CHECK (duration_ms >= 0),
  ADD CONSTRAINT ck_calculate_logs__postcode CHECK (delivery_postcode IS NULL OR delivery_postcode ~ '^[0-9]{5}$');
ALTER TABLE search_logs
  ADD CONSTRAINT ck_search_logs__results_count CHECK (results_count >= 0);
