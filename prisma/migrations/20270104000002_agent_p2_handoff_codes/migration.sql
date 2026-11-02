-- D-467 (agent portal pack, Phase 2): one-time hand-off codes from the storefront to the agent zone (agent.getpack.co),
-- no shared cookie. Only SHA-256 of the code and of the device fingerprint are stored. New table only; rollback: down.sql.
-- CreateTable
CREATE TABLE "auth_handoff_codes" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" BIGINT NOT NULL,
    "target" "auth_client" NOT NULL,
    "code_hash" BYTEA NOT NULL,
    "fingerprint_hash" BYTEA NOT NULL,
    "source_session_family_id" UUID,
    "login_method" "login_method" NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "redeemed_session_family_id" UUID,
    "ip" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_auth_handoff_codes" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_auth_handoff_codes__public_id" ON "auth_handoff_codes"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_auth_handoff_codes__code_hash" ON "auth_handoff_codes"("code_hash");

-- CreateIndex
CREATE INDEX "ix_auth_handoff_codes__user_id" ON "auth_handoff_codes"("user_id");

-- CreateIndex
CREATE INDEX "ix_auth_handoff_codes__expires_at" ON "auth_handoff_codes"("expires_at");

-- AddForeignKey
ALTER TABLE "auth_handoff_codes" ADD CONSTRAINT "fk_auth_handoff_codes__user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

