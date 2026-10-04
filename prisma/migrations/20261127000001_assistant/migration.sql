-- U5.B5 (schema-design A-113; D-304–D-306, D-218): glossary terms, help embeddings, assistant sessions, turns and evaluation runs.
-- CreateEnum
CREATE TYPE "assistant_session_status" AS ENUM ('open', 'ended', 'limit_reached');

-- CreateEnum
CREATE TYPE "assistant_turn_outcome" AS ENUM ('answered', 'blocked_unsupported_fact', 'refused', 'handed_off', 'failed');

-- CreateTable
CREATE TABLE "glossary_terms" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "term_th" TEXT NOT NULL,
    "term_en" TEXT,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "definition_th" TEXT NOT NULL,
    "definition_en" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" "content_status" NOT NULL DEFAULT 'draft',
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_glossary_terms" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "help_embeddings" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" BIGINT NOT NULL,
    "chunk_index" SMALLINT NOT NULL,
    "model" TEXT NOT NULL,
    "model_version" TEXT NOT NULL,
    "content_sha256" BYTEA NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_help_embeddings" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_sessions" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "customer_user_id" BIGINT NOT NULL,
    "status" "assistant_session_status" NOT NULL DEFAULT 'open',
    "logging_opt_out" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "last_turn_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_assistant_sessions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_turns" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "session_id" BIGINT NOT NULL,
    "turn_no" INTEGER NOT NULL,
    "user_text" TEXT,
    "reply_text" TEXT,
    "tool_calls" JSONB NOT NULL DEFAULT '[]',
    "outcome" "assistant_turn_outcome" NOT NULL,
    "validation" JSONB NOT NULL DEFAULT '{}',
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_assistant_turns" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_eval_runs" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "suite_version" TEXT NOT NULL,
    "cases" INTEGER NOT NULL,
    "passed" INTEGER NOT NULL,
    "red_team_cases" INTEGER NOT NULL,
    "red_team_passed" INTEGER NOT NULL,
    "pass_rate_pct" DECIMAL(5,2) NOT NULL,
    "results" JSONB NOT NULL,
    "cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "requested_by" BIGINT,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pk_assistant_eval_runs" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_glossary_terms__public_id" ON "glossary_terms"("public_id");

-- CreateIndex
CREATE INDEX "ix_glossary_terms__term_th_trgm" ON "glossary_terms" USING GIN ("term_th" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ix_glossary_terms__created_by" ON "glossary_terms"("created_by");

-- CreateIndex
CREATE INDEX "ix_glossary_terms__updated_by" ON "glossary_terms"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_help_embeddings__subject__model__chunk" ON "help_embeddings"("subject_type", "subject_id", "model", "model_version", "chunk_index");

-- CreateIndex
CREATE UNIQUE INDEX "ux_assistant_sessions__public_id" ON "assistant_sessions"("public_id");

-- CreateIndex
CREATE INDEX "ix_assistant_sessions__customer_user_id__created_at" ON "assistant_sessions"("customer_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_assistant_sessions__last_turn_at" ON "assistant_sessions"("last_turn_at");

-- CreateIndex
CREATE UNIQUE INDEX "ux_assistant_turns__session_id__turn_no" ON "assistant_turns"("session_id", "turn_no");

-- CreateIndex
CREATE UNIQUE INDEX "ux_assistant_eval_runs__public_id" ON "assistant_eval_runs"("public_id");

-- CreateIndex
CREATE INDEX "ix_assistant_eval_runs__provider__model__finished_at" ON "assistant_eval_runs"("provider", "model", "finished_at" DESC);

-- CreateIndex
CREATE INDEX "ix_assistant_eval_runs__requested_by" ON "assistant_eval_runs"("requested_by");

-- AddForeignKey
ALTER TABLE "glossary_terms" ADD CONSTRAINT "fk_glossary_terms__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "glossary_terms" ADD CONSTRAINT "fk_glossary_terms__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assistant_sessions" ADD CONSTRAINT "fk_assistant_sessions__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assistant_turns" ADD CONSTRAINT "fk_assistant_turns__session_id" FOREIGN KEY ("session_id") REFERENCES "assistant_sessions"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assistant_eval_runs" ADD CONSTRAINT "fk_assistant_eval_runs__requested_by" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written (A-113).
-- No HNSW index: the help corpus is Packio's own articles and FAQs (small), searched exactly by cosine distance;
-- Prisma cannot declare an HNSW index, so one would show as drift (add it when the corpus needs it).
ALTER TABLE help_embeddings
  ADD CONSTRAINT ck_help_embeddings__subject_type CHECK (subject_type IN ('article', 'faq')),
  ADD CONSTRAINT ck_help_embeddings__sha CHECK (octet_length(content_sha256) = 32);
ALTER TABLE glossary_terms
  ADD CONSTRAINT ck_glossary_terms__texts CHECK (btrim(term_th) <> '' AND btrim(definition_th) <> '');
ALTER TABLE assistant_sessions
  ADD CONSTRAINT ck_assistant_sessions__counts CHECK (turns >= 0 AND input_tokens >= 0 AND output_tokens >= 0 AND cost_usd >= 0);
ALTER TABLE assistant_turns
  ADD CONSTRAINT ck_assistant_turns__tool_calls CHECK (jsonb_typeof(tool_calls) = 'array'),
  ADD CONSTRAINT ck_assistant_turns__turn_no CHECK (turn_no >= 1);
ALTER TABLE assistant_eval_runs
  ADD CONSTRAINT ck_assistant_eval_runs__trigger CHECK (trigger IN ('nightly', 'manual')),
  ADD CONSTRAINT ck_assistant_eval_runs__counts CHECK (
    passed BETWEEN 0 AND cases AND red_team_passed BETWEEN 0 AND red_team_cases AND pass_rate_pct BETWEEN 0 AND 100);
CREATE TRIGGER tg_assistant_eval_runs__no_delete BEFORE DELETE ON assistant_eval_runs
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();
