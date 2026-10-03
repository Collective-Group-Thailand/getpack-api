-- A-93 (U3.B5, D-270, D-271): dieline renders cached by sha256 of (engine version, recipe checksum, options, sizes,
-- material, format), the dieline download log (D-203 limits counted from it), and the engine version of style assets.
-- AlterTable
ALTER TABLE "style_assets" ADD COLUMN     "engine_version" TEXT;

-- CreateTable
CREATE TABLE "dieline_renders" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "cache_key" BYTEA NOT NULL,
    "variant_id" BIGINT NOT NULL,
    "recipe_id" BIGINT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "material_class" TEXT NOT NULL,
    "length_mm" DECIMAL(10,2) NOT NULL,
    "width_mm" DECIMAL(10,2) NOT NULL,
    "height_mm" DECIMAL(10,2) NOT NULL,
    "format" "drawing_format" NOT NULL,
    "file_id" BIGINT NOT NULL,
    "quantities" JSONB NOT NULL,
    "violations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_dieline_renders" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dieline_downloads" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" BIGINT NOT NULL,
    "render_id" BIGINT NOT NULL,
    "staff" BOOLEAN NOT NULL,
    "measurement_basis" "measurement_basis" NOT NULL,
    "entered_length_mm" DECIMAL(10,2) NOT NULL,
    "entered_width_mm" DECIMAL(10,2) NOT NULL,
    "entered_height_mm" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_dieline_downloads" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_dieline_renders__public_id" ON "dieline_renders"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_dieline_renders__cache_key" ON "dieline_renders"("cache_key");

-- CreateIndex
CREATE INDEX "ix_dieline_renders__variant_id" ON "dieline_renders"("variant_id");

-- CreateIndex
CREATE INDEX "ix_dieline_renders__recipe_id" ON "dieline_renders"("recipe_id");

-- CreateIndex
CREATE INDEX "ix_dieline_renders__file_id" ON "dieline_renders"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_dieline_downloads__public_id" ON "dieline_downloads"("public_id");

-- CreateIndex
CREATE INDEX "ix_dieline_downloads__user_id__created_at" ON "dieline_downloads"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_dieline_downloads__render_id" ON "dieline_downloads"("render_id");

-- AddForeignKey
ALTER TABLE "dieline_renders" ADD CONSTRAINT "fk_dieline_renders__variant_id" FOREIGN KEY ("variant_id") REFERENCES "style_variants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dieline_renders" ADD CONSTRAINT "fk_dieline_renders__recipe_id" FOREIGN KEY ("recipe_id") REFERENCES "style_recipes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dieline_renders" ADD CONSTRAINT "fk_dieline_renders__file_id" FOREIGN KEY ("file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dieline_downloads" ADD CONSTRAINT "fk_dieline_downloads__user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "dieline_downloads" ADD CONSTRAINT "fk_dieline_downloads__render_id" FOREIGN KEY ("render_id") REFERENCES "dieline_renders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- Hand-written checks and triggers (A-93).
ALTER TABLE dieline_renders
  ADD CONSTRAINT ck_dieline_renders__cache_key CHECK (octet_length(cache_key) = 32),
  ADD CONSTRAINT ck_dieline_renders__sizes CHECK (length_mm > 0 AND width_mm > 0 AND height_mm >= 0),
  ADD CONSTRAINT ck_dieline_renders__quantities CHECK (jsonb_typeof(quantities) = 'object');
ALTER TABLE dieline_downloads
  ADD CONSTRAINT ck_dieline_downloads__sizes CHECK (
    entered_length_mm > 0 AND entered_width_mm > 0 AND entered_height_mm >= 0);
-- A render is the cached answer for its key and a download is a log line: neither changes nor goes.
CREATE TRIGGER tg_dieline_renders__write_once BEFORE UPDATE OR DELETE ON dieline_renders
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER tg_dieline_downloads__append_only BEFORE UPDATE OR DELETE ON dieline_downloads
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
