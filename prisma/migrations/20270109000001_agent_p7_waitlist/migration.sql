-- P7 pilot switch (agent portal pack, docs/design/agent-portal): the public landing's waiting list for the agent
-- programme. Anonymous sign-ups with a name, a phone or an e-mail (at least one), how they sell and the consent
-- record relied on (purpose `agent_waitlist`). PDPA: kept until 12 months after the public opening or until the
-- person asks; read by Sales Manager / C-Level only. Non-destructive. Rollback: down.sql.
-- CreateTable
CREATE TABLE "sales_agent_waitlist" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" CITEXT,
    "sales_channel" "sales_agent_sales_channel",
    "consent_record_id" BIGINT NOT NULL,
    "join_count" INTEGER NOT NULL DEFAULT 1,
    "last_joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_sales_agent_waitlist" PRIMARY KEY ("id"),
    CONSTRAINT "ck_sales_agent_waitlist__contact" CHECK ("phone" IS NOT NULL OR "email" IS NOT NULL),
    CONSTRAINT "ck_sales_agent_waitlist__name" CHECK (char_length(btrim("name")) BETWEEN 1 AND 120),
    CONSTRAINT "ck_sales_agent_waitlist__join_count" CHECK ("join_count" >= 1)
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_waitlist__public_id" ON "sales_agent_waitlist"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_waitlist__phone" ON "sales_agent_waitlist"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "ux_sales_agent_waitlist__email" ON "sales_agent_waitlist"("email");

-- CreateIndex
CREATE INDEX "ix_sales_agent_waitlist__created_at" ON "sales_agent_waitlist"("created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_sales_agent_waitlist__consent_record_id" ON "sales_agent_waitlist"("consent_record_id");

-- AddForeignKey
ALTER TABLE "sales_agent_waitlist" ADD CONSTRAINT "fk_sales_agent_waitlist__consent_record_id" FOREIGN KEY ("consent_record_id") REFERENCES "consent_records"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
