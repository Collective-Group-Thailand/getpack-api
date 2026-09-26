-- B2.5: a new RFQ quotation can be drafted while the previous one is with the customer (sent supersedes).

-- DropIndex
DROP INDEX "ux_rfq_quotes__one_open";

-- CreateIndex
CREATE UNIQUE INDEX "ux_rfq_quotes__one_draft" ON "rfq_quotes"("rfq_id") WHERE (status = 'draft'::rfq_quote_status);

-- CreateIndex
CREATE UNIQUE INDEX "ux_rfq_quotes__one_sent" ON "rfq_quotes"("rfq_id") WHERE (status = 'sent'::rfq_quote_status);

