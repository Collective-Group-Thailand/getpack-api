-- U2.1 (schema-design A-82, D-185, finding F5): quote share links expire like design links (configurations.share_link_days,
-- 15 days) and stop resolving once revoked, expired or the quote is no longer shared. Links issued before get the same
-- expiry from their sharing day.

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "share_expires_at" TIMESTAMPTZ(6);


-- Hand-written (A-82)
UPDATE quotes SET share_expires_at = shared_at + interval '15 days' WHERE share_token_hash IS NOT NULL AND shared_at IS NOT NULL;
ALTER TABLE quotes
  ADD CONSTRAINT ck_quotes__share_expiry CHECK (share_expires_at IS NULL OR share_token_hash IS NOT NULL);
