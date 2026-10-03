-- U5.B2 (schema-design A-110; D-300, D-221, D-151): conversation subjects, company, SLA, reply channel, LINE merge, participants, notes, context cards, canned responses.
-- CreateEnum
CREATE TYPE "conversation_subject" AS ENUM ('support', 'order', 'design', 'rfq', 'rfq_basket');

-- CreateEnum
CREATE TYPE "reply_channel" AS ENUM ('web', 'line');

-- CreateEnum
CREATE TYPE "participant_role" AS ENUM ('customer', 'staff');

-- DropIndex
DROP INDEX "ux_conversations__one_live_web";

-- AlterTable
ALTER TABLE "conversation_messages" ADD COLUMN     "canned_response_id" BIGINT,
ADD COLUMN     "context_card" JSONB,
ADD COLUMN     "via" "reply_channel",
ADD COLUMN     "visibility" "message_visibility" NOT NULL DEFAULT 'customer';

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "company_id" BIGINT,
ADD COLUMN     "first_responded_at" TIMESTAMPTZ(6),
ADD COLUMN     "first_response_due_at" TIMESTAMPTZ(6),
ADD COLUMN     "last_inbound_via" "reply_channel",
ADD COLUMN     "merged_into_id" BIGINT,
ADD COLUMN     "reply_channel" "reply_channel",
ADD COLUMN     "resolution_due_at" TIMESTAMPTZ(6),
ADD COLUMN     "subject_id" BIGINT,
ADD COLUMN     "subject_type" "conversation_subject" NOT NULL DEFAULT 'support';

-- CreateTable
CREATE TABLE "conversation_participants" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "conversation_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "role" "participant_role" NOT NULL,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_read_at" TIMESTAMPTZ(6),
    "last_read_message_id" BIGINT,

    CONSTRAINT "pk_conversation_participants" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canned_responses" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "title" TEXT NOT NULL,
    "body_th" TEXT NOT NULL,
    "body_en" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "archived_at" TIMESTAMPTZ(6),
    "created_by" BIGINT NOT NULL,
    "updated_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_canned_responses" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_conversation_participants__user_id" ON "conversation_participants"("user_id");

-- CreateIndex
CREATE INDEX "ix_conversation_participants__last_read_message_id" ON "conversation_participants"("last_read_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_conversation_participants__conversation_id__user_id" ON "conversation_participants"("conversation_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_canned_responses__public_id" ON "canned_responses"("public_id");

-- CreateIndex
CREATE INDEX "ix_canned_responses__created_by" ON "canned_responses"("created_by");

-- CreateIndex
CREATE INDEX "ix_canned_responses__updated_by" ON "canned_responses"("updated_by");

-- CreateIndex
CREATE INDEX "ix_conversation_messages__canned_response_id" ON "conversation_messages"("canned_response_id");

-- CreateIndex
CREATE INDEX "ix_conversations__company_id" ON "conversations"("company_id");

-- CreateIndex
CREATE INDEX "ix_conversations__merged_into_id" ON "conversations"("merged_into_id");

-- CreateIndex
CREATE INDEX "ix_conversations__awaiting_first_response" ON "conversations"("first_response_due_at") WHERE ((first_responded_at IS NULL) AND (status <> 'closed'::conversation_status));

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "fk_conversations__company_id" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "fk_conversations__merged_into_id" FOREIGN KEY ("merged_into_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "fk_conversation_messages__canned_response_id" FOREIGN KEY ("canned_response_id") REFERENCES "canned_responses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "fk_conversation_participants__conversation_id" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "fk_conversation_participants__user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "fk_conversation_participants__last_read_message_id" FOREIGN KEY ("last_read_message_id") REFERENCES "conversation_messages"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "canned_responses" ADD CONSTRAINT "fk_canned_responses__created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "canned_responses" ADD CONSTRAINT "fk_canned_responses__updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written (A-110). Before D-300 a customer could hold a live LINE and a live web conversation at once; they are
-- one support thread now, so any extra live one (oldest activity) is closed before the uniqueness applies (dev data).
UPDATE conversations c SET status = 'closed', closed_at = now()
  FROM (SELECT id, row_number() OVER (PARTITION BY customer_user_id ORDER BY last_message_at DESC, id DESC) AS rn
          FROM conversations
         WHERE customer_user_id IS NOT NULL AND status <> 'closed' AND channel::text <> 'contact') d
 WHERE c.id = d.id AND d.rn > 1;
-- One live thread per customer × subject (a guest's `contact` tickets stay one per ticket).
CREATE UNIQUE INDEX ux_conversations__one_live_subject
  ON conversations (customer_user_id, subject_type, COALESCE(subject_id, 0))
  WHERE customer_user_id IS NOT NULL AND status <> 'closed' AND channel <> 'contact'::conversation_channel;
ALTER TABLE conversations
  ADD CONSTRAINT ck_conversations__subject CHECK ((subject_type = 'support') = (subject_id IS NULL)),
  ADD CONSTRAINT ck_conversations__subject_customer CHECK (subject_type = 'support' OR customer_user_id IS NOT NULL),
  ADD CONSTRAINT ck_conversations__merged CHECK (merged_into_id IS NULL OR status = 'closed'),
  ADD CONSTRAINT ck_conversations__merged_self CHECK (merged_into_id IS NULL OR merged_into_id <> id);
ALTER TABLE conversation_messages
  ADD CONSTRAINT ck_conversation_messages__context_card CHECK (
    context_card IS NULL OR (jsonb_typeof(context_card) = 'object'
      AND context_card->>'type' IN ('order', 'design', 'rfq', 'quote') AND (context_card->>'id') IS NOT NULL)),
  ADD CONSTRAINT ck_conversation_messages__note CHECK (visibility = 'customer' OR direction = 'outbound');
ALTER TABLE canned_responses
  ADD CONSTRAINT ck_canned_responses__title CHECK (btrim(title) <> '' AND length(title) <= 120),
  ADD CONSTRAINT ck_canned_responses__bodies CHECK (btrim(body_th) <> '' AND btrim(body_en) <> '');
CREATE TRIGGER tg_canned_responses__no_delete BEFORE DELETE ON canned_responses
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();
CREATE TRIGGER tg_conversation_participants__no_delete BEFORE DELETE ON conversation_participants
  FOR EACH ROW EXECUTE FUNCTION tg_forbid_delete();
