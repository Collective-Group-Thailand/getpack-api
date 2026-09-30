-- U1 U-B0.1 slice 10 (schema-design A-58): a guest's contact-form / hand-off ticket opens a `contact` conversation
-- without a customer (CS answers by phone or e-mail, D-221). The new value is compared as text: it cannot be used as
-- an enum literal in the transaction that adds it.

-- AlterEnum
ALTER TYPE "conversation_channel" ADD VALUE 'contact';

ALTER TABLE conversations DROP CONSTRAINT ck_conversations__party;
ALTER TABLE conversations
  ADD CONSTRAINT ck_conversations__party CHECK (
    (channel::text = 'line' AND line_account_id IS NOT NULL)
    OR (channel::text = 'web' AND customer_user_id IS NOT NULL)
    OR (channel::text = 'contact' AND customer_user_id IS NULL AND line_account_id IS NULL)
  );
