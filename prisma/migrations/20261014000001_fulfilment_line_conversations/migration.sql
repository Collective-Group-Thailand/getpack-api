-- CreateEnum
CREATE TYPE "line_friend_status" AS ENUM ('followed', 'blocked', 'unknown');

-- CreateEnum
CREATE TYPE "rich_menu_audience" AS ENUM ('guest', 'member');

-- CreateEnum
CREATE TYPE "conversation_channel" AS ENUM ('line', 'web');

-- CreateEnum
CREATE TYPE "conversation_status" AS ENUM ('open', 'pending', 'closed');

-- CreateEnum
CREATE TYPE "message_direction" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "message_kind" AS ENUM ('text', 'image', 'file', 'sticker', 'system');

-- CreateTable
CREATE TABLE "line_accounts" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" BIGINT,
    "line_user_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "display_name" TEXT,
    "picture_url" TEXT,
    "friend_status" "line_friend_status" NOT NULL DEFAULT 'unknown',
    "rich_menu_key" TEXT,
    "linked_at" TIMESTAMPTZ(6),
    "unlinked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_line_accounts" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_rich_menus" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "key" TEXT NOT NULL,
    "audience" "rich_menu_audience" NOT NULL,
    "provider_menu_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,

    CONSTRAINT "pk_line_rich_menus" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "channel" "conversation_channel" NOT NULL,
    "customer_user_id" BIGINT,
    "line_account_id" BIGINT,
    "status" "conversation_status" NOT NULL DEFAULT 'open',
    "assigned_user_id" BIGINT,
    "last_message_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_conversations" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "conversation_id" BIGINT NOT NULL,
    "direction" "message_direction" NOT NULL,
    "sender_user_id" BIGINT,
    "kind" "message_kind" NOT NULL,
    "body" TEXT,
    "file_object_id" BIGINT,
    "provider_message_id" TEXT,
    "sent_at" TIMESTAMPTZ(6) NOT NULL,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_conversation_messages" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_line_accounts__public_id" ON "line_accounts"("public_id");

-- CreateIndex
CREATE INDEX "ix_line_accounts__user_id" ON "line_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_line_accounts__channel_id__line_user_id" ON "line_accounts"("channel_id", "line_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_line_rich_menus__key" ON "line_rich_menus"("key");

-- CreateIndex
CREATE INDEX "ix_line_rich_menus__updated_by" ON "line_rich_menus"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "ux_line_rich_menus__one_active" ON "line_rich_menus"("audience") WHERE (active);

-- CreateIndex
CREATE UNIQUE INDEX "ux_conversations__public_id" ON "conversations"("public_id");

-- CreateIndex
CREATE INDEX "ix_conversations__status__last_message_at" ON "conversations"("status", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "ix_conversations__assigned_user_id__status" ON "conversations"("assigned_user_id", "status");

-- CreateIndex
CREATE INDEX "ix_conversations__customer_user_id" ON "conversations"("customer_user_id");

-- CreateIndex
CREATE INDEX "ix_conversations__line_account_id" ON "conversations"("line_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_conversations__one_live_line" ON "conversations"("line_account_id") WHERE ((line_account_id IS NOT NULL) AND (status <> 'closed'::conversation_status));

-- CreateIndex
CREATE UNIQUE INDEX "ux_conversations__one_live_web" ON "conversations"("customer_user_id") WHERE ((channel = 'web'::conversation_channel) AND (status <> 'closed'::conversation_status));

-- CreateIndex
CREATE UNIQUE INDEX "ux_conversation_messages__public_id" ON "conversation_messages"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_conversation_messages__provider_message_id" ON "conversation_messages"("provider_message_id");

-- CreateIndex
CREATE INDEX "ix_conversation_messages__conversation_id__sent_at" ON "conversation_messages"("conversation_id", "sent_at");

-- CreateIndex
CREATE INDEX "ix_conversation_messages__sender_user_id" ON "conversation_messages"("sender_user_id");

-- CreateIndex
CREATE INDEX "ix_conversation_messages__file_object_id" ON "conversation_messages"("file_object_id");

-- AddForeignKey
ALTER TABLE "line_accounts" ADD CONSTRAINT "fk_line_accounts__user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "line_rich_menus" ADD CONSTRAINT "fk_line_rich_menus__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "fk_conversations__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "fk_conversations__line_account_id" FOREIGN KEY ("line_account_id") REFERENCES "line_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "fk_conversations__assigned_user_id" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "fk_conversation_messages__conversation_id" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "fk_conversation_messages__sender_user_id" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "fk_conversation_messages__file_object_id" FOREIGN KEY ("file_object_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- =====================================================================================================
-- Hand-written: LINE accounts, rich menus, conversations (D-143, D-151; schema-design §3.7, A-40)
-- =====================================================================================================
ALTER TABLE line_accounts
  ADD CONSTRAINT ck_line_accounts__ids CHECK (btrim(line_user_id) <> '' AND btrim(channel_id) <> ''),
  ADD CONSTRAINT ck_line_accounts__linked CHECK (user_id IS NULL OR linked_at IS NOT NULL);

ALTER TABLE line_rich_menus
  ADD CONSTRAINT ck_line_rich_menus__key CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  ADD CONSTRAINT ck_line_rich_menus__provider CHECK (btrim(provider_menu_id) <> '');

ALTER TABLE conversations
  ADD CONSTRAINT ck_conversations__party CHECK (
    (channel = 'line' AND line_account_id IS NOT NULL) OR (channel = 'web' AND customer_user_id IS NOT NULL)),
  ADD CONSTRAINT ck_conversations__closed CHECK ((status = 'closed') = (closed_at IS NOT NULL));
CREATE TRIGGER tg_conversations__no_delete BEFORE DELETE ON conversations
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();

ALTER TABLE conversation_messages
  ADD CONSTRAINT ck_conversation_messages__content CHECK (
    (kind = 'text' AND body IS NOT NULL AND btrim(body) <> '') OR kind <> 'text'),
  ADD CONSTRAINT ck_conversation_messages__sender CHECK (direction = 'inbound' OR sender_user_id IS NOT NULL OR kind = 'system');
CREATE TRIGGER tg_conversation_messages__append_only BEFORE DELETE ON conversation_messages
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();
