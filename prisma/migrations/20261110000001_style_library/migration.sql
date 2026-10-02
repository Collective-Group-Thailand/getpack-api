-- U3.B1 (schema-design A-86; D-184, D-211, D-212, D-241–D-243): the style library — base structures imported from the
-- master file, generated variants with their publishability and reasons, versioned recipes, assets, synonyms, use
-- cases and the import runs (checksum, diff, changes held for approval).

-- CreateEnum
CREATE TYPE "style_status" AS ENUM ('active', 'retired');

-- CreateEnum
CREATE TYPE "style_import_kind" AS ENUM ('master', 'recipes');

-- CreateEnum
CREATE TYPE "style_import_status" AS ENUM ('applied', 'pending_approval', 'rejected');

-- CreateEnum
CREATE TYPE "style_asset_kind" AS ENUM ('thumbnail_2d', 'thumbnail_3d', 'dieline_svg', 'manifest');

-- CreateTable
CREATE TABLE "style_bases" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "code" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "source_product_type" TEXT NOT NULL,
    "product_type_id" BIGINT,
    "pattern_id" BIGINT,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "construction" TEXT NOT NULL,
    "material_class" TEXT NOT NULL,
    "variant_axes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "wave" SMALLINT NOT NULL,
    "complexity" TEXT,
    "reference_code" TEXT,
    "reference_verified_at" TIMESTAMPTZ(6),
    "reference_verified_by" BIGINT,
    "pricing_path_at_launch" TEXT,
    "names_approved_marketing_at" TIMESTAMPTZ(6),
    "names_approved_marketing_by" BIGINT,
    "names_approved_prepress_at" TIMESTAMPTZ(6),
    "names_approved_prepress_by" BIGINT,
    "description_th" TEXT,
    "description_en" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" "style_status" NOT NULL DEFAULT 'active',
    "published_at" TIMESTAMPTZ(6),
    "source_sha256" BYTEA NOT NULL,
    "last_import_run_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_style_bases" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "style_variants" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "base_id" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "code_suffix" TEXT NOT NULL,
    "option_key" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "publishable" BOOLEAN NOT NULL DEFAULT false,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evaluated_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "status" "style_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_style_variants" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "style_recipes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "base_id" BIGINT NOT NULL,
    "version" INTEGER NOT NULL,
    "schema_version" TEXT NOT NULL,
    "recipe" JSONB NOT NULL,
    "checksum" BYTEA NOT NULL,
    "processes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "size_ranges" JSONB,
    "approved_at" TIMESTAMPTZ(6),
    "approved_by" BIGINT,
    "import_run_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_style_recipes" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "style_assets" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "base_id" BIGINT NOT NULL,
    "variant_id" BIGINT,
    "kind" "style_asset_kind" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "sha256" BYTEA NOT NULL,
    "content_type" TEXT NOT NULL,
    "recipe_version" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_style_assets" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "style_synonyms" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "base_id" BIGINT NOT NULL,
    "locale" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_style_synonyms" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "style_use_cases" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "base_id" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_style_use_cases" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "style_import_runs" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "kind" "style_import_kind" NOT NULL,
    "file_name" TEXT NOT NULL,
    "checksum" BYTEA NOT NULL,
    "status" "style_import_status" NOT NULL,
    "diff" JSONB NOT NULL,
    "pending_changes" JSONB,
    "axes" JSONB,
    "approval_request_id" BIGINT,
    "created_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_style_import_runs" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_style_bases__public_id" ON "style_bases"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_style_bases__code" ON "style_bases"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ux_style_bases__pattern_id" ON "style_bases"("pattern_id");

-- CreateIndex
CREATE INDEX "ix_style_bases__category__status" ON "style_bases"("category", "status");

-- CreateIndex
CREATE INDEX "ix_style_bases__product_type_id" ON "style_bases"("product_type_id");

-- CreateIndex
CREATE INDEX "ix_style_bases__reference_verified_by" ON "style_bases"("reference_verified_by");

-- CreateIndex
CREATE INDEX "ix_style_bases__names_approved_marketing_by" ON "style_bases"("names_approved_marketing_by");

-- CreateIndex
CREATE INDEX "ix_style_bases__names_approved_prepress_by" ON "style_bases"("names_approved_prepress_by");

-- CreateIndex
CREATE INDEX "ix_style_bases__updated_by" ON "style_bases"("updated_by");

-- CreateIndex
CREATE INDEX "ix_style_bases__last_import_run_id" ON "style_bases"("last_import_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_style_variants__public_id" ON "style_variants"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_style_variants__code" ON "style_variants"("code");

-- CreateIndex
CREATE INDEX "ix_style_variants__base_id__publishable" ON "style_variants"("base_id", "publishable");

-- CreateIndex
CREATE UNIQUE INDEX "ux_style_variants__base_id__option_key" ON "style_variants"("base_id", "option_key");

-- CreateIndex
CREATE UNIQUE INDEX "ux_style_recipes__public_id" ON "style_recipes"("public_id");

-- CreateIndex
CREATE INDEX "ix_style_recipes__approved_by" ON "style_recipes"("approved_by");

-- CreateIndex
CREATE INDEX "ix_style_recipes__import_run_id" ON "style_recipes"("import_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_style_recipes__base_id__version" ON "style_recipes"("base_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ux_style_assets__public_id" ON "style_assets"("public_id");

-- CreateIndex
CREATE INDEX "ix_style_assets__base_id__kind" ON "style_assets"("base_id", "kind");

-- CreateIndex
CREATE INDEX "ix_style_assets__variant_id" ON "style_assets"("variant_id");

-- CreateIndex
CREATE INDEX "ix_style_synonyms__base_id" ON "style_synonyms"("base_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_style_use_cases__base_id__code" ON "style_use_cases"("base_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ux_style_import_runs__public_id" ON "style_import_runs"("public_id");

-- CreateIndex
CREATE INDEX "ix_style_import_runs__kind__checksum" ON "style_import_runs"("kind", "checksum");

-- CreateIndex
CREATE INDEX "ix_style_import_runs__approval_request_id" ON "style_import_runs"("approval_request_id");

-- CreateIndex
CREATE INDEX "ix_style_import_runs__created_by" ON "style_import_runs"("created_by");

-- AddForeignKey
ALTER TABLE "style_bases" ADD CONSTRAINT "fk_style_bases__product_type_id" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_bases" ADD CONSTRAINT "fk_style_bases__pattern_id" FOREIGN KEY ("pattern_id") REFERENCES "patterns"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_bases" ADD CONSTRAINT "fk_style_bases__reference_verified_by" FOREIGN KEY ("reference_verified_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_bases" ADD CONSTRAINT "fk_style_bases__names_approved_marketing_by" FOREIGN KEY ("names_approved_marketing_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_bases" ADD CONSTRAINT "fk_style_bases__names_approved_prepress_by" FOREIGN KEY ("names_approved_prepress_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_bases" ADD CONSTRAINT "fk_style_bases__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_bases" ADD CONSTRAINT "fk_style_bases__last_import_run_id" FOREIGN KEY ("last_import_run_id") REFERENCES "style_import_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_variants" ADD CONSTRAINT "fk_style_variants__base_id" FOREIGN KEY ("base_id") REFERENCES "style_bases"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_recipes" ADD CONSTRAINT "fk_style_recipes__base_id" FOREIGN KEY ("base_id") REFERENCES "style_bases"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_recipes" ADD CONSTRAINT "fk_style_recipes__approved_by" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_recipes" ADD CONSTRAINT "fk_style_recipes__import_run_id" FOREIGN KEY ("import_run_id") REFERENCES "style_import_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_assets" ADD CONSTRAINT "fk_style_assets__base_id" FOREIGN KEY ("base_id") REFERENCES "style_bases"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_assets" ADD CONSTRAINT "fk_style_assets__variant_id" FOREIGN KEY ("variant_id") REFERENCES "style_variants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_synonyms" ADD CONSTRAINT "fk_style_synonyms__base_id" FOREIGN KEY ("base_id") REFERENCES "style_bases"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_use_cases" ADD CONSTRAINT "fk_style_use_cases__base_id" FOREIGN KEY ("base_id") REFERENCES "style_bases"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_import_runs" ADD CONSTRAINT "fk_style_import_runs__approval_request_id" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "style_import_runs" ADD CONSTRAINT "fk_style_import_runs__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- Hand-written (A-86)
ALTER TABLE style_bases
  ADD CONSTRAINT ck_style_bases__code CHECK (code ~ '^PK-[A-Z0-9]{2,8}-[0-9]{2,3}$'),
  ADD CONSTRAINT ck_style_bases__wave CHECK (wave BETWEEN 1 AND 9),
  ADD CONSTRAINT ck_style_bases__names CHECK (btrim(name_th) <> '' AND btrim(name_en) <> ''),
  ADD CONSTRAINT ck_style_bases__reference_verified CHECK (
    reference_verified_at IS NULL OR (reference_code IS NOT NULL AND reference_verified_by IS NOT NULL)),
  ADD CONSTRAINT ck_style_bases__names_marketing CHECK (
    (names_approved_marketing_at IS NULL) = (names_approved_marketing_by IS NULL)),
  ADD CONSTRAINT ck_style_bases__names_prepress CHECK (
    (names_approved_prepress_at IS NULL) = (names_approved_prepress_by IS NULL));

ALTER TABLE style_variants
  ADD CONSTRAINT ck_style_variants__suffix CHECK (code_suffix ~ '^[A-Z2-7]{4,8}$'),
  ADD CONSTRAINT ck_style_variants__code CHECK (code LIKE '%-' || code_suffix),
  ADD CONSTRAINT ck_style_variants__publishable CHECK (NOT publishable OR cardinality(reasons) = 0);

-- D-184 / D-241: a published base or variant keeps its code.
CREATE FUNCTION tg_style_codes__frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.published_at IS NOT NULL AND NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION '% % is published: its code is frozen', TG_TABLE_NAME, OLD.code USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at THEN
    RAISE EXCEPTION '% % keeps its first publication time', TG_TABLE_NAME, OLD.code USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_style_bases__frozen BEFORE UPDATE ON style_bases
  FOR EACH ROW EXECUTE FUNCTION tg_style_codes__frozen();
CREATE TRIGGER tg_style_variants__frozen BEFORE UPDATE ON style_variants
  FOR EACH ROW EXECUTE FUNCTION tg_style_codes__frozen();
-- Nothing is deleted (D-242): retired instead.
CREATE TRIGGER tg_style_bases__no_delete BEFORE DELETE ON style_bases
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER tg_style_variants__no_delete BEFORE DELETE ON style_variants
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE style_recipes
  ADD CONSTRAINT ck_style_recipes__version CHECK (version >= 1),
  ADD CONSTRAINT ck_style_recipes__approved CHECK ((approved_at IS NULL) = (approved_by IS NULL)),
  ADD CONSTRAINT ck_style_recipes__recipe CHECK (jsonb_typeof(recipe) = 'object');
-- A recipe version never changes; only its Prepress approval is stamped, once.
CREATE FUNCTION tg_style_recipes__write_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'style recipes are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.approved_at IS NOT NULL
     OR NEW.base_id <> OLD.base_id OR NEW.version <> OLD.version OR NEW.schema_version <> OLD.schema_version
     OR NEW.recipe <> OLD.recipe OR NEW.checksum <> OLD.checksum OR NEW.processes <> OLD.processes
     OR NEW.size_ranges IS DISTINCT FROM OLD.size_ranges OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'style recipe % is write-once', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_style_recipes__write_once BEFORE UPDATE OR DELETE ON style_recipes
  FOR EACH ROW EXECUTE FUNCTION tg_style_recipes__write_once();

ALTER TABLE style_assets
  ADD CONSTRAINT ck_style_assets__storage_key CHECK (btrim(storage_key) <> '');

ALTER TABLE style_synonyms
  ADD CONSTRAINT ck_style_synonyms__locale CHECK (locale IN ('th', 'en')),
  ADD CONSTRAINT ck_style_synonyms__term CHECK (btrim(term) <> '');
CREATE UNIQUE INDEX ux_style_synonyms__base_id__locale__term ON style_synonyms (base_id, locale, lower(term));

ALTER TABLE style_use_cases
  ADD CONSTRAINT ck_style_use_cases__code CHECK (code ~ '^[a-z][a-z0-9_]*$');

-- D-242: one live import per input (same checksum = no-op); a rejected one may be imported again.
CREATE UNIQUE INDEX ux_style_import_runs__kind__checksum__live ON style_import_runs (kind, checksum)
  WHERE status <> 'rejected';
ALTER TABLE style_import_runs
  ADD CONSTRAINT ck_style_import_runs__pending CHECK (
    (status = 'pending_approval') = (approval_request_id IS NOT NULL AND decided_at IS NULL) OR status <> 'pending_approval');
