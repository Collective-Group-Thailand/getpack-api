-- D-427 / ADR-0013 document content search: the text of stored files (text layer or Tesseract OCR), chunked for
-- keyword search (pg_trgm) and search by meaning (pgvector); the allowlist of files worth reading as a view.

-- CreateEnum
CREATE TYPE "file_text_status" AS ENUM ('pending', 'indexed', 'empty', 'unsupported', 'too_large', 'failed');

-- CreateTable
CREATE TABLE "file_texts" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "file_object_id" BIGINT NOT NULL,
    "status" "file_text_status" NOT NULL DEFAULT 'pending',
    "method" TEXT,
    "page_count" INTEGER,
    "ocr_pages" INTEGER NOT NULL DEFAULT 0,
    "skipped_pages" INTEGER NOT NULL DEFAULT 0,
    "char_count" INTEGER NOT NULL DEFAULT 0,
    "ocr_confidence" DECIMAL(5,2),
    "text_sha256" BYTEA,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "lease_until" TIMESTAMPTZ(6),
    "retry_at" TIMESTAMPTZ(6),
    "extracted_at" TIMESTAMPTZ(6),
    "embedded_model" TEXT,
    "embedded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_file_texts" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_text_chunks" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "file_text_id" BIGINT NOT NULL,
    "file_object_id" BIGINT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "page" INTEGER,
    "sheet" TEXT,
    "ocr" BOOLEAN NOT NULL DEFAULT false,
    "content" TEXT NOT NULL,
    "search_text" TEXT NOT NULL,
    "search_skeleton" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_file_text_chunks" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_file_texts__file_object_id" ON "file_texts"("file_object_id");

-- CreateIndex
CREATE INDEX "ix_file_texts__status__retry_at" ON "file_texts"("status", "retry_at");

-- CreateIndex
CREATE UNIQUE INDEX "ux_file_text_chunks__file_text_id__chunk_index" ON "file_text_chunks"("file_text_id", "chunk_index");

-- CreateIndex
CREATE INDEX "ix_file_text_chunks__file_object_id" ON "file_text_chunks"("file_object_id");

-- CreateIndex
CREATE INDEX "ix_file_text_chunks__search_text_trgm" ON "file_text_chunks" USING GIN ("search_text" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ix_file_text_chunks__search_skeleton_trgm" ON "file_text_chunks" USING GIN ("search_skeleton" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "file_texts" ADD CONSTRAINT "fk_file_texts__file_object_id" FOREIGN KEY ("file_object_id") REFERENCES "file_objects"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "file_text_chunks" ADD CONSTRAINT "fk_file_text_chunks__file_text_id" FOREIGN KEY ("file_text_id") REFERENCES "file_texts"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- --- schema `search`: kept out of Prisma (an HNSW index and a view; the drift check reads `public` only) -----------
CREATE SCHEMA IF NOT EXISTS search;

-- One vector per chunk per embedding model. 384 dimensions = multilingual-e5-small (ADR-0013); another model with
-- another size gets its own table, so a model change never mixes vector spaces.
CREATE TABLE search.file_text_embeddings (
    "chunk_id" BIGINT NOT NULL,
    "model" TEXT NOT NULL,
    "model_version" TEXT NOT NULL,
    "embedding" vector(384) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_file_text_embeddings" PRIMARY KEY ("chunk_id", "model", "model_version"),
    CONSTRAINT "fk_file_text_embeddings__chunk_id" FOREIGN KEY ("chunk_id") REFERENCES public.file_text_chunks("id")
        ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE INDEX "ix_file_text_embeddings__embedding_hnsw" ON search.file_text_embeddings
    USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- The allowlist (ADR-0013 §Sources): every place a stored file is used that content search covers, whose it is
-- (`factory_id` scopes the partner surface), the record above it (`parent_id`: a job's order) and the permission that shows it on each surface (null = never there).
-- Not listed, so never read: identity and bank documents (company / factory KYC, sales-agent ID cards and bank books),
-- privacy and audit exports, report runs, bank files, artwork and design files, catalogue / CMS images, avatars,
-- fonts, imports, thumbnails.
CREATE VIEW search.file_usages AS
-- partner ERP (D-356, D-360 – D-368): the factory's own documents and the PDFs its ERP issued -------------------
SELECT 'erp_doc'::text AS source, v.file_id, d.public_id AS subject_id, NULL::uuid AS parent_id,
       NULL::text AS code, d.title, d.factory_id, NULL::text AS admin_permission,
       'factory_documents.read'::text AS partner_permission, v.version, (v.version = d.current_version) AS current,
       (d.status = 'active') AS active, v.created_at AS used_at
  FROM erp_doc_versions v JOIN erp_docs d ON d.id = v.doc_id
UNION ALL
SELECT 'erp_supplier_invoice', s.file_id, s.public_id, NULL, s.doc_no, p.name || ' · ' || s.invoice_no, s.factory_id,
       NULL, 'factory_ap.read', NULL, true, s.status <> 'cancelled', s.created_at
  FROM erp_supplier_invoices s JOIN erp_trading_partners p ON p.id = s.supplier_id WHERE s.file_id IS NOT NULL
UNION ALL
SELECT 'erp_quotation', q.pdf_file_id, q.public_id, NULL, q.quote_no, p.name, q.factory_id,
       NULL, 'factory_sales.read', q.pdf_version, true, true, q.updated_at
  FROM erp_quotations q JOIN erp_trading_partners p ON p.id = q.customer_id WHERE q.pdf_file_id IS NOT NULL
UNION ALL
SELECT 'erp_delivery_note', n.pdf_file_id, n.public_id, NULL, n.do_no, p.name, n.factory_id,
       NULL, 'factory_sales.read', n.pdf_version, true, true, n.updated_at
  FROM erp_delivery_notes n JOIN erp_trading_partners p ON p.id = n.customer_id WHERE n.pdf_file_id IS NOT NULL
UNION ALL
SELECT 'erp_delivery_pod', n.pod_file_id, n.public_id, NULL, n.do_no, p.name, n.factory_id,
       NULL, 'factory_sales.read', NULL, true, true, n.updated_at
  FROM erp_delivery_notes n JOIN erp_trading_partners p ON p.id = n.customer_id WHERE n.pod_file_id IS NOT NULL
UNION ALL
SELECT 'erp_sales_invoice', i.pdf_file_id, i.public_id, NULL, i.invoice_no, p.name, i.factory_id,
       NULL, 'factory_receivables.read', i.pdf_version, true, true, i.updated_at
  FROM erp_sales_invoices i JOIN erp_trading_partners p ON p.id = i.customer_id WHERE i.pdf_file_id IS NOT NULL
UNION ALL
SELECT 'erp_sales_note', n.pdf_file_id, n.public_id, NULL, n.note_no, p.name, n.factory_id,
       NULL, 'factory_receivables.read', n.pdf_version, true, true, n.updated_at
  FROM erp_sales_notes n JOIN erp_trading_partners p ON p.id = n.customer_id WHERE n.pdf_file_id IS NOT NULL
UNION ALL
SELECT 'erp_receipt', r.pdf_file_id, r.public_id, NULL, r.receipt_no, p.name, r.factory_id,
       NULL, 'factory_receivables.read', r.pdf_version, true, true, r.created_at
  FROM erp_customer_receipts r JOIN erp_trading_partners p ON p.id = r.customer_id WHERE r.pdf_file_id IS NOT NULL
UNION ALL
SELECT 'erp_receipt_wht', r.wht_file_id, r.public_id, NULL, r.receipt_no, p.name, r.factory_id,
       NULL, 'factory_receivables.read', NULL, true, true, r.created_at
  FROM erp_customer_receipts r JOIN erp_trading_partners p ON p.id = r.customer_id WHERE r.wht_file_id IS NOT NULL
UNION ALL
SELECT 'erp_billing_note', b.pdf_file_id, b.public_id, NULL, b.billing_no, p.name, b.factory_id,
       NULL, 'factory_receivables.read', b.pdf_version, true, true, b.created_at
  FROM erp_billing_notes b JOIN erp_trading_partners p ON p.id = b.customer_id WHERE b.pdf_file_id IS NOT NULL
UNION ALL
SELECT 'erp_wht_certificate', w.pdf_file_id, w.public_id, NULL, w.cert_no, p.name, w.factory_id,
       NULL, 'factory_ap.read', w.pdf_version, true, true, w.created_at
  FROM erp_wht_certificates w JOIN erp_trading_partners p ON p.id = w.supplier_id WHERE w.pdf_file_id IS NOT NULL
UNION ALL
SELECT 'erp_quality_check', c.pdf_file_id, c.public_id, NULL, c.qc_no, NULL, c.factory_id,
       NULL, 'factory_quality.read', c.pdf_version, true, true, c.updated_at
  FROM erp_quality_checks c WHERE c.pdf_file_id IS NOT NULL
UNION ALL
SELECT 'erp_maintenance_photo', ph.file_id, o.public_id, NULL, o.mt_no, o.title, o.factory_id,
       NULL, 'factory_maintenance.read', NULL, true, true, ph.created_at
  FROM erp_maintenance_photos ph JOIN erp_maintenance_orders o ON o.id = ph.order_id
-- getpack work both sides see -------------------------------------------------------------------------------------
UNION ALL
SELECT 'job_attachment', a.file_object_id, j.public_id, o.public_id, j.job_no, a.subject_type::text, j.factory_id,
       'production.read', 'factory_jobs.read', NULL, true, true, a.created_at
  FROM attachments a
  JOIN production_jobs j ON j.id = CASE a.subject_type
         WHEN 'job_milestone' THEN (SELECT m.job_id FROM job_milestones m WHERE m.id = a.subject_id)
         WHEN 'qc_check' THEN (SELECT q.job_id FROM qc_checks q WHERE q.id = a.subject_id)
         WHEN 'job_issue' THEN (SELECT i.job_id FROM job_issues i WHERE i.id = a.subject_id)
       END
  JOIN orders o ON o.id = j.order_id
 WHERE a.subject_type IN ('job_milestone', 'qc_check', 'job_issue')
UNION ALL
SELECT 'shipment_label', s.label_file_id, s.public_id, NULL, s.shipment_no, s.recipient_name, s.factory_id,
       'shipments.read', 'factory_shipments.read', NULL, true, true, s.created_at
  FROM shipments s WHERE s.label_file_id IS NOT NULL
UNION ALL
SELECT 'shipment_packing_list', s.packing_list_file_id, s.public_id, NULL, s.shipment_no, s.recipient_name,
       s.factory_id, 'shipments.read', 'factory_shipments.read', NULL, true, true, s.created_at
  FROM shipments s WHERE s.packing_list_file_id IS NOT NULL
UNION ALL
SELECT 'agreement_signed', g.signed_file_id, f.public_id, NULL, f.code, t.name, g.factory_id,
       'partners.read', 'factory_profile.read', v.version_no, true, true, g.accepted_at
  FROM agreement_acceptances g
  JOIN factories f ON f.id = g.factory_id
  JOIN agreement_template_versions v ON v.id = g.template_version_id
  JOIN agreement_templates t ON t.id = v.template_id
 WHERE g.signed_file_id IS NOT NULL
UNION ALL
SELECT 'board_strength_sheet', b.data_sheet_file_id, f.public_id, NULL, f.code, f.legal_name, b.factory_id,
       'partners.read', 'factory_profile.read', b.version_no, true, true, b.created_at
  FROM board_strength_sheets b JOIN factories f ON f.id = b.factory_id
-- getpack back office only ----------------------------------------------------------------------------------------
UNION ALL
SELECT 'inspection_attachment', a.file_object_id, j.public_id, o.public_id, j.job_no, 'inspection', j.factory_id,
       'production.read', NULL, NULL, true, true, a.created_at
  FROM attachments a JOIN inspections i ON i.id = a.subject_id JOIN production_jobs j ON j.id = i.job_id
  JOIN orders o ON o.id = j.order_id
 WHERE a.subject_type = 'inspection'
UNION ALL
SELECT 'claim_attachment', a.file_object_id, c.public_id, NULL, c.claim_no, NULL, c.factory_id,
       'claims.read', NULL, NULL, true, true, a.created_at
  FROM attachments a JOIN claims c ON c.id = a.subject_id WHERE a.subject_type = 'claim'
UNION ALL
SELECT 'rfq_attachment', a.file_object_id, r.public_id, NULL, r.rfq_code, NULL, NULL,
       'rfqs.read', NULL, NULL, true, true, a.created_at
  FROM attachments a
  JOIN rfqs r ON r.id = CASE a.subject_type
         WHEN 'rfq' THEN a.subject_id
         WHEN 'rfq_message' THEN (SELECT m.rfq_id FROM rfq_messages m WHERE m.id = a.subject_id)
       END
 WHERE a.subject_type IN ('rfq', 'rfq_message')
UNION ALL
SELECT 'company_attachment', a.file_object_id, c.public_id, NULL, c.company_code, c.legal_name, NULL,
       'companies.read', NULL, NULL, true, true, a.created_at
  FROM attachments a JOIN companies c ON c.id = a.subject_id WHERE a.subject_type = 'company'
UNION ALL
SELECT 'factory_attachment', a.file_object_id, f.public_id, NULL, f.code, f.legal_name, f.id,
       'partners.read', NULL, NULL, true, true, a.created_at
  FROM attachments a
  JOIN factories f ON f.id = CASE a.subject_type
         WHEN 'factory' THEN a.subject_id
         WHEN 'site_visit' THEN (SELECT s.factory_id FROM site_visits s WHERE s.id = a.subject_id)
       END
 WHERE a.subject_type IN ('factory', 'site_visit')
UNION ALL
SELECT 'price_proposal_attachment', a.file_object_id, p.public_id, NULL, NULL, NULL, NULL,
       'factory_buy_prices.read', NULL, NULL, true, true, a.created_at
  FROM attachments a JOIN price_proposals p ON p.id = a.subject_id WHERE a.subject_type = 'price_proposal'
UNION ALL
SELECT 'discount_memo_attachment', a.file_object_id, m.public_id, NULL, NULL, m.reason, NULL,
       'discount_memos.read', NULL, NULL, true, true, a.created_at
  FROM attachments a JOIN discount_memos m ON m.id = a.subject_id WHERE a.subject_type = 'discount_memo'
UNION ALL
SELECT 'sample_attachment', a.file_object_id, s.public_id, NULL, NULL, NULL, NULL,
       'samples.read', NULL, NULL, true, true, a.created_at
  FROM attachments a JOIN samples s ON s.id = a.subject_id WHERE a.subject_type = 'sample'
UNION ALL
SELECT 'design_service_attachment', a.file_object_id, o.public_id, NULL, o.order_code, NULL, NULL,
       'artwork.read', NULL, NULL, true, true, a.created_at
  FROM attachments a JOIN design_service_requests d ON d.id = a.subject_id JOIN orders o ON o.id = d.order_id
 WHERE a.subject_type = 'design_service_request'
UNION ALL
SELECT 'vendor_invoice_attachment', a.file_object_id, v.public_id, NULL, v.vendor_invoice_no, NULL, NULL,
       'payables.read', NULL, NULL, true, true, a.created_at
  FROM attachments a JOIN vendor_invoices v ON v.id = a.subject_id WHERE a.subject_type = 'vendor_invoice'
UNION ALL
SELECT 'close_task_attachment', a.file_object_id, t.public_id, NULL, t.key, NULL, NULL,
       'close.read', NULL, NULL, true, true, a.created_at
  FROM attachments a JOIN close_tasks t ON t.id = a.subject_id WHERE a.subject_type = 'close_task'
UNION ALL
SELECT 'other_attachment', a.file_object_id, NULL, NULL, NULL, a.role, NULL,
       'files.read', NULL, NULL, true, true, a.created_at
  FROM attachments a WHERE a.subject_type IN ('other', 'proof_of_delivery')
UNION ALL
SELECT 'vendor_invoice', v.file_object_id, v.public_id, NULL, v.vendor_invoice_no, n.legal_name, NULL,
       'payables.read', NULL, NULL, true, v.status NOT IN ('rejected', 'void'), v.created_at
  FROM vendor_invoices v JOIN vendors n ON n.id = v.vendor_id WHERE v.file_object_id IS NOT NULL
UNION ALL
SELECT 'wht_certificate', w.file_object_id, w.public_id, NULL, w.wt_number, n.legal_name, NULL,
       'payables.read', NULL, NULL, true, true, w.created_at
  FROM wht_certificates w JOIN vendors n ON n.id = w.vendor_id WHERE w.file_object_id IS NOT NULL
UNION ALL
SELECT 'payout_remittance', i.remittance_file_id, r.public_id, NULL, i.pv_number, n.legal_name, NULL,
       'payables.read', NULL, NULL, true, true, i.created_at
  FROM payout_items i JOIN payout_runs r ON r.id = i.run_id JOIN vendors n ON n.id = i.vendor_id
 WHERE i.remittance_file_id IS NOT NULL
UNION ALL
SELECT 'customer_document', d.pdf_file_id, d.public_id, NULL, d.doc_number, NULL, NULL,
       'receivables.read', NULL, NULL, true, true, d.issued_at
  FROM customer_documents d WHERE d.pdf_file_id IS NOT NULL
UNION ALL
SELECT 'customer_wht_certificate', w.file_object_id, d.public_id, NULL, w.certificate_no, d.doc_number, NULL,
       'receivables.read', NULL, NULL, true, true, w.created_at
  FROM customer_wht_certificates w JOIN customer_documents d ON d.id = w.customer_document_id
 WHERE w.file_object_id IS NOT NULL
UNION ALL
SELECT 'company_statement', s.file_object_id, c.public_id, NULL, to_char(s.period_month, 'YYYY-MM'), c.legal_name,
       NULL, 'receivables.read', NULL, NULL, true, true, s.generated_at
  FROM company_statements s JOIN companies c ON c.id = s.company_id WHERE s.file_object_id IS NOT NULL
UNION ALL
SELECT 'quote', q.pdf_file_id, q.public_id, NULL, q.quote_code, NULL, NULL,
       'quotes.read', NULL, NULL, true, true, q.created_at
  FROM quotes q WHERE q.pdf_file_id IS NOT NULL
UNION ALL
SELECT 'slip', s.file_object_id, p.public_id, NULL, p.reference_code, NULL, NULL,
       'payments.read', NULL, NULL, true, true, s.created_at
  FROM slips s JOIN payments p ON p.id = s.payment_id
UNION ALL
SELECT 'conversation_file', m.file_object_id, c.public_id, NULL, NULL, m.visibility::text, NULL,
       'conversations.read', NULL, NULL, true, true, m.created_at
  FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.file_object_id IS NOT NULL
UNION ALL
SELECT 'agreement_template', v.pdf_file_id, NULL, NULL, t.key, t.name, NULL,
       'partners.read', NULL, v.version_no, true, true, v.created_at
  FROM agreement_template_versions v JOIN agreement_templates t ON t.id = v.template_id WHERE v.pdf_file_id IS NOT NULL
UNION ALL
SELECT 'structural_request_file', rf.file_id, r.public_id, NULL, NULL, NULL, NULL,
       'styles.read', NULL, NULL, true, true, rf.created_at
  FROM structural_design_request_files rf JOIN structural_design_requests r ON r.id = rf.request_id
UNION ALL
SELECT 'structural_request_delivery', r.delivered_file_id, r.public_id, NULL, NULL, NULL, NULL,
       'styles.read', NULL, NULL, true, true, r.delivered_at
  FROM structural_design_requests r WHERE r.delivered_file_id IS NOT NULL
UNION ALL
SELECT 'style_intake', s.file_id, s.public_id, NULL, NULL, s.title, s.factory_id,
       'styles.read', NULL, NULL, true, true, s.created_at
  FROM style_intakes s;

COMMENT ON VIEW search.file_usages IS
    'D-427 / ADR-0013: the files content search reads, where each is used, whose it is and who may see it.';
