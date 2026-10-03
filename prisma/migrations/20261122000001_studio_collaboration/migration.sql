-- U4.B6 (schema-design A-100; D-285, D-286): design share links with a scope (view / comment / edit), anchored and
-- threaded design comments with mentions, and the studio design a design-service request works on.
-- CreateEnum
CREATE TYPE "share_scope" AS ENUM ('view', 'comment', 'edit');

-- AlterTable
ALTER TABLE "design_service_requests" ADD COLUMN     "design_document_id" BIGINT;

-- CreateTable
CREATE TABLE "design_share_links" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "document_id" BIGINT NOT NULL,
    "scope" "share_scope" NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "created_by" BIGINT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_design_share_links" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_comments" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "document_id" BIGINT NOT NULL,
    "version_id" BIGINT,
    "parent_id" BIGINT,
    "author_user_id" BIGINT NOT NULL,
    "body" TEXT NOT NULL,
    "anchor" JSONB,
    "mentioned_user_ids" BIGINT[] DEFAULT ARRAY[]::BIGINT[],
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_design_comments" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_design_share_links__public_id" ON "design_share_links"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_design_share_links__token_hash" ON "design_share_links"("token_hash");

-- CreateIndex
CREATE INDEX "ix_design_share_links__document_id" ON "design_share_links"("document_id");

-- CreateIndex
CREATE INDEX "ix_design_share_links__created_by" ON "design_share_links"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_design_comments__public_id" ON "design_comments"("public_id");

-- CreateIndex
CREATE INDEX "ix_design_comments__document_id__created_at" ON "design_comments"("document_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_design_comments__version_id" ON "design_comments"("version_id");

-- CreateIndex
CREATE INDEX "ix_design_comments__parent_id" ON "design_comments"("parent_id");

-- CreateIndex
CREATE INDEX "ix_design_comments__author_user_id" ON "design_comments"("author_user_id");

-- CreateIndex
CREATE INDEX "ix_design_comments__resolved_by" ON "design_comments"("resolved_by");

-- CreateIndex
CREATE INDEX "ix_design_service_requests__design_document_id" ON "design_service_requests"("design_document_id");

-- AddForeignKey
ALTER TABLE "design_service_requests" ADD CONSTRAINT "fk_design_service_requests__design_document_id" FOREIGN KEY ("design_document_id") REFERENCES "design_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_share_links" ADD CONSTRAINT "fk_design_share_links__document_id" FOREIGN KEY ("document_id") REFERENCES "design_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_share_links" ADD CONSTRAINT "fk_design_share_links__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_comments" ADD CONSTRAINT "fk_design_comments__document_id" FOREIGN KEY ("document_id") REFERENCES "design_documents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_comments" ADD CONSTRAINT "fk_design_comments__version_id" FOREIGN KEY ("version_id") REFERENCES "design_document_versions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_comments" ADD CONSTRAINT "fk_design_comments__parent_id" FOREIGN KEY ("parent_id") REFERENCES "design_comments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_comments" ADD CONSTRAINT "fk_design_comments__author_user_id" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "design_comments" ADD CONSTRAINT "fk_design_comments__resolved_by" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- Hand-written checks and triggers (A-100).
ALTER TABLE design_share_links
  ADD CONSTRAINT ck_design_share_links__token_hash CHECK (octet_length(token_hash) = 32),
  ADD CONSTRAINT ck_design_share_links__expiry CHECK (expires_at > created_at);
-- A link is revoked once and never deleted (who shared what, when, stays known).
CREATE FUNCTION tg_design_share_links__frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'design share links are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.document_id <> OLD.document_id OR NEW.scope <> OLD.scope OR NEW.token_hash <> OLD.token_hash
     OR NEW.created_by <> OLD.created_by OR NEW.expires_at <> OLD.expires_at OR OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'design share link % is frozen', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_design_share_links__frozen BEFORE UPDATE OR DELETE ON design_share_links
  FOR EACH ROW EXECUTE FUNCTION tg_design_share_links__frozen();

ALTER TABLE design_comments
  ADD CONSTRAINT ck_design_comments__body CHECK (btrim(body) <> '' AND length(body) <= 4000),
  ADD CONSTRAINT ck_design_comments__anchor CHECK (anchor IS NULL OR jsonb_typeof(anchor) = 'object'),
  ADD CONSTRAINT ck_design_comments__reply CHECK (parent_id IS NULL OR anchor IS NULL),
  ADD CONSTRAINT ck_design_comments__resolved CHECK ((resolved_at IS NULL) = (resolved_by IS NULL));
-- A comment is never edited or deleted; only a thread's resolution is written, once.
CREATE FUNCTION tg_design_comments__frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'design comments are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.document_id <> OLD.document_id OR NEW.version_id IS DISTINCT FROM OLD.version_id
     OR NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.author_user_id <> OLD.author_user_id
     OR NEW.body <> OLD.body OR NEW.anchor IS DISTINCT FROM OLD.anchor
     OR NEW.mentioned_user_ids <> OLD.mentioned_user_ids OR OLD.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'design comment % is frozen', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tg_design_comments__frozen BEFORE UPDATE OR DELETE ON design_comments
  FOR EACH ROW EXECUTE FUNCTION tg_design_comments__frozen();
