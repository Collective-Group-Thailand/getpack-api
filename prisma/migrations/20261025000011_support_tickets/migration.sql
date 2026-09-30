-- U1 U-B0.1 slice 10 (schema-design A-58): support tickets from the contact form and the guided-help hand-off,
-- opened on CS conversations (D-221); document type support_ticket for their numbers.

-- CreateEnum
CREATE TYPE "support_ticket_source" AS ENUM ('contact_form', 'handoff');

-- AlterEnum
ALTER TYPE "document_type" ADD VALUE 'support_ticket';

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL DEFAULT uuidv7(),
    "ticket_no" TEXT NOT NULL,
    "conversation_id" BIGINT NOT NULL,
    "customer_user_id" BIGINT,
    "source" "support_ticket_source" NOT NULL,
    "topic" TEXT NOT NULL,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "order_ref" TEXT,
    "callback_requested" BOOLEAN NOT NULL DEFAULT false,
    "context" JSONB,
    "respond_by" TIMESTAMPTZ(6) NOT NULL,
    "first_responded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_support_tickets" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_support_tickets__public_id" ON "support_tickets"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_support_tickets__ticket_no" ON "support_tickets"("ticket_no");

-- CreateIndex
CREATE INDEX "ix_support_tickets__conversation_id" ON "support_tickets"("conversation_id");

-- CreateIndex
CREATE INDEX "ix_support_tickets__customer_user_id" ON "support_tickets"("customer_user_id");

-- CreateIndex
CREATE INDEX "ix_support_tickets__unanswered__respond_by" ON "support_tickets"("respond_by") WHERE (first_responded_at IS NULL);

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "fk_support_tickets__conversation_id" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "fk_support_tickets__customer_user_id" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Hand-written checks.
ALTER TABLE "support_tickets" ADD CONSTRAINT "ck_support_tickets__contact"
  CHECK (customer_user_id IS NOT NULL
      OR (contact_name IS NOT NULL AND (contact_phone IS NOT NULL OR contact_email IS NOT NULL)));
ALTER TABLE "support_tickets" ADD CONSTRAINT "ck_support_tickets__lengths"
  CHECK (char_length(topic) BETWEEN 1 AND 40
     AND (contact_name IS NULL OR char_length(contact_name) BETWEEN 1 AND 200)
     AND (contact_phone IS NULL OR char_length(contact_phone) BETWEEN 1 AND 40)
     AND (contact_email IS NULL OR char_length(contact_email) BETWEEN 3 AND 254)
     AND (order_ref IS NULL OR char_length(order_ref) BETWEEN 1 AND 40));
ALTER TABLE "support_tickets" ADD CONSTRAINT "ck_support_tickets__respond_by"
  CHECK (respond_by >= created_at);
