-- U4.B5 (schema-design A-99; D-282, D-284): company brand kits with their logos, Packio's studio templates and
-- elements (Marketing approval, rights to use marks with legal meaning) and the licence of design fonts.
-- CreateEnum
CREATE TYPE "studio_catalog_status" AS ENUM ('draft', 'pending_approval', 'published', 'retired');

-- CreateEnum
CREATE TYPE "studio_element_kind" AS ENUM ('shape', 'icon', 'mark');

-- CreateEnum
CREATE TYPE "font_licence" AS ENUM ('ofl', 'proprietary', 'unknown');

-- AlterTable
ALTER TABLE "design_fonts" ADD COLUMN     "embedding_allowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "licence" "font_licence" NOT NULL DEFAULT 'unknown',
ADD COLUMN     "print_allowed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "brand_kits" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "palette" JSONB NOT NULL DEFAULT '[]',
    "font_pairs" JSONB NOT NULL DEFAULT '[]',
    "usage_notes" TEXT,
    "status" "catalog_status" NOT NULL DEFAULT 'active',
    "created_by" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_brand_kits" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_kit_logos" (
    "kit_id" BIGINT NOT NULL,
    "brand_asset_id" BIGINT NOT NULL,
    "role" TEXT NOT NULL,
    "sort" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "pk_brand_kit_logos" PRIMARY KEY ("kit_id","brand_asset_id")
);

-- CreateTable
CREATE TABLE "studio_templates" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "code" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "use_cases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "style_families" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "layout_schema_version" SMALLINT NOT NULL,
    "layout" JSONB NOT NULL,
    "thumbnail_file_id" BIGINT,
    "status" "studio_catalog_status" NOT NULL DEFAULT 'draft',
    "created_by" BIGINT NOT NULL,
    "submitted_at" TIMESTAMPTZ(6),
    "approved_by" BIGINT,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_studio_templates" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_elements" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "code" TEXT NOT NULL,
    "kind" "studio_element_kind" NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requires_right" BOOLEAN NOT NULL DEFAULT false,
    "status" "studio_catalog_status" NOT NULL DEFAULT 'draft',
    "created_by" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_studio_elements" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "element_right_declarations" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "element_id" BIGINT NOT NULL,
    "company_id" BIGINT,
    "user_id" BIGINT,
    "statement" TEXT NOT NULL,
    "declared_by" BIGINT NOT NULL,
    "declared_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_element_right_declarations" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_brand_kits__public_id" ON "brand_kits"("public_id");

-- CreateIndex
CREATE INDEX "ix_brand_kits__company_id" ON "brand_kits"("company_id");

-- CreateIndex
CREATE INDEX "ix_brand_kits__created_by" ON "brand_kits"("created_by");

-- CreateIndex
CREATE INDEX "ix_brand_kit_logos__brand_asset_id" ON "brand_kit_logos"("brand_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_studio_templates__public_id" ON "studio_templates"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_studio_templates__code" ON "studio_templates"("code");

-- CreateIndex
CREATE INDEX "ix_studio_templates__status" ON "studio_templates"("status");

-- CreateIndex
CREATE INDEX "ix_studio_templates__thumbnail_file_id" ON "studio_templates"("thumbnail_file_id");

-- CreateIndex
CREATE INDEX "ix_studio_templates__created_by" ON "studio_templates"("created_by");

-- CreateIndex
CREATE INDEX "ix_studio_templates__approved_by" ON "studio_templates"("approved_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_studio_elements__public_id" ON "studio_elements"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_studio_elements__code" ON "studio_elements"("code");

-- CreateIndex
CREATE INDEX "ix_studio_elements__status" ON "studio_elements"("status");

-- CreateIndex
CREATE INDEX "ix_studio_elements__created_by" ON "studio_elements"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_element_right_declarations__public_id" ON "element_right_declarations"("public_id");

-- CreateIndex
CREATE INDEX "ix_element_right_declarations__element_id" ON "element_right_declarations"("element_id");

-- CreateIndex
CREATE INDEX "ix_element_right_declarations__company_id" ON "element_right_declarations"("company_id");

-- CreateIndex
CREATE INDEX "ix_element_right_declarations__user_id" ON "element_right_declarations"("user_id");

-- CreateIndex
CREATE INDEX "ix_element_right_declarations__declared_by" ON "element_right_declarations"("declared_by");

-- AddForeignKey
ALTER TABLE "brand_kits" ADD CONSTRAINT "fk_brand_kits__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "brand_kits" ADD CONSTRAINT "fk_brand_kits__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "brand_kit_logos" ADD CONSTRAINT "fk_brand_kit_logos__kit_id" FOREIGN KEY ("kit_id") REFERENCES "brand_kits"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "brand_kit_logos" ADD CONSTRAINT "fk_brand_kit_logos__brand_asset_id" FOREIGN KEY ("brand_asset_id") REFERENCES "company_brand_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "studio_templates" ADD CONSTRAINT "fk_studio_templates__thumbnail_file_id" FOREIGN KEY ("thumbnail_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "studio_templates" ADD CONSTRAINT "fk_studio_templates__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "studio_templates" ADD CONSTRAINT "fk_studio_templates__approved_by" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "studio_elements" ADD CONSTRAINT "fk_studio_elements__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "element_right_declarations" ADD CONSTRAINT "fk_element_right_declarations__element_id" FOREIGN KEY ("element_id") REFERENCES "studio_elements"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "element_right_declarations" ADD CONSTRAINT "fk_element_right_declarations__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "element_right_declarations" ADD CONSTRAINT "fk_element_right_declarations__user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "element_right_declarations" ADD CONSTRAINT "fk_element_right_declarations__declared_by" FOREIGN KEY ("declared_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- Hand-written checks and triggers (A-99).
ALTER TABLE brand_kits
  ADD CONSTRAINT ck_brand_kits__name CHECK (btrim(name) <> ''),
  ADD CONSTRAINT ck_brand_kits__palette CHECK (jsonb_typeof(palette) = 'array'),
  ADD CONSTRAINT ck_brand_kits__font_pairs CHECK (jsonb_typeof(font_pairs) = 'array');
ALTER TABLE brand_kit_logos
  ADD CONSTRAINT ck_brand_kit_logos__role CHECK (role IN ('primary', 'secondary', 'mark'));
ALTER TABLE studio_templates
  ADD CONSTRAINT ck_studio_templates__code CHECK (code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  ADD CONSTRAINT ck_studio_templates__layout CHECK (jsonb_typeof(layout) = 'object'),
  ADD CONSTRAINT ck_studio_templates__approved CHECK (
    (status IN ('published', 'retired') AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    OR (status IN ('draft', 'pending_approval') AND approved_by IS NULL)),
  ADD CONSTRAINT ck_studio_templates__maker_checker CHECK (approved_by IS NULL OR approved_by <> created_by);
ALTER TABLE studio_elements
  ADD CONSTRAINT ck_studio_elements__code CHECK (code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  ADD CONSTRAINT ck_studio_elements__path CHECK (btrim(path) <> '' AND length(path) <= 20000);
ALTER TABLE element_right_declarations
  ADD CONSTRAINT ck_element_right_declarations__holder CHECK ((company_id IS NULL) <> (user_id IS NULL)),
  ADD CONSTRAINT ck_element_right_declarations__statement CHECK (btrim(statement) <> '');
-- One live declaration per element and holder.
CREATE UNIQUE INDEX ux_element_right_declarations__live ON element_right_declarations
  (element_id, coalesce(company_id, 0), coalesce(user_id, 0)) WHERE revoked_at IS NULL;
-- A declaration is evidence: only its revocation is ever written, once; it is never deleted.
CREATE FUNCTION tg_element_right_declarations__frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'element right declarations are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.element_id <> OLD.element_id OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.statement <> OLD.statement
     OR NEW.declared_by <> OLD.declared_by OR NEW.declared_at <> OLD.declared_at OR OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'element right declaration % is frozen', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_element_right_declarations__frozen BEFORE UPDATE OR DELETE ON element_right_declarations
  FOR EACH ROW EXECUTE FUNCTION tg_element_right_declarations__frozen();
