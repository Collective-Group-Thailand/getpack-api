-- D-468 (agent portal pack, Phase 3; PLAN A-13): the sales playbook as versioned cards (one published version per
-- key). Non-destructive. Rollback: down.sql.
-- CreateEnum
CREATE TYPE "sales_playbook_audience" AS ENUM ('agent', 'rep', 'manager');

-- CreateEnum
CREATE TYPE "sales_playbook_card_status" AS ENUM ('draft', 'published', 'retired');

-- CreateTable
CREATE TABLE "sales_playbook_cards" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "key" VARCHAR(64) NOT NULL,
    "version" SMALLINT NOT NULL,
    "contexts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "audiences" "sales_playbook_audience"[] DEFAULT ARRAY[]::"sales_playbook_audience"[],
    "title_th" TEXT NOT NULL,
    "title_en" TEXT,
    "body_th" TEXT NOT NULL,
    "body_en" TEXT,
    "suggested_replies" JSONB NOT NULL DEFAULT '[]',
    "sort" SMALLINT NOT NULL DEFAULT 0,
    "status" "sales_playbook_card_status" NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMPTZ(6),
    "source" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_sales_playbook_cards" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_playbook_cards__public_id" ON "sales_playbook_cards"("public_id");

-- CreateIndex
CREATE INDEX "ix_sales_playbook_cards__status__sort" ON "sales_playbook_cards"("status", "sort");

-- CreateIndex
CREATE INDEX "ix_sales_playbook_cards__contexts" ON "sales_playbook_cards" USING GIN ("contexts");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_playbook_cards__key__version" ON "sales_playbook_cards"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_playbook_cards__key__published" ON "sales_playbook_cards"("key") WHERE (status = 'published'::sales_playbook_card_status);

