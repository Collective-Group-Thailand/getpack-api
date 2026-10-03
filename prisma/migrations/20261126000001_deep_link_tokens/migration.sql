-- U5.B1 (schema-design A-109; D-299): notification deep-link tokens.
-- CreateTable
CREATE TABLE "deep_link_tokens" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "notification_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "surface" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "last_opened_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_deep_link_tokens" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_deep_link_tokens__token_hash" ON "deep_link_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "ux_deep_link_tokens__notification_id" ON "deep_link_tokens"("notification_id");

-- CreateIndex
CREATE INDEX "ix_deep_link_tokens__user_id" ON "deep_link_tokens"("user_id");

-- CreateIndex
CREATE INDEX "ix_deep_link_tokens__expires_at" ON "deep_link_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "deep_link_tokens" ADD CONSTRAINT "fk_deep_link_tokens__notification_id" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "deep_link_tokens" ADD CONSTRAINT "fk_deep_link_tokens__user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written checks (A-109).
ALTER TABLE deep_link_tokens
  ADD CONSTRAINT ck_deep_link_tokens__surface CHECK (surface IN ('store', 'admin', 'partner')),
  ADD CONSTRAINT ck_deep_link_tokens__path CHECK (path LIKE '/%' AND length(path) <= 300),
  ADD CONSTRAINT ck_deep_link_tokens__token_hash CHECK (octet_length(token_hash) = 32),
  ADD CONSTRAINT ck_deep_link_tokens__open_count CHECK (open_count >= 0);
