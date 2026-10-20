/**
 * Where a searchable file is used (D-427, ADR-0013 §Sources) — one key per branch of the `search.file_usages` view
 * (migration `20261212000001_file_text_search`; `file-search.sources.spec.ts` keeps the two lists equal). The view
 * says, per row, which permission shows it on the back office and on the partner portal; these lists only say which
 * keys a surface may filter by.
 */
export const PARTNER_FILE_SOURCES = [
  'erp_doc',
  'erp_supplier_invoice',
  'erp_quotation',
  'erp_delivery_note',
  'erp_delivery_pod',
  'erp_sales_invoice',
  'erp_sales_note',
  'erp_receipt',
  'erp_receipt_wht',
  'erp_billing_note',
  'erp_wht_certificate',
  'erp_quality_check',
  'erp_maintenance_photo',
  'job_attachment',
  'shipment_label',
  'shipment_packing_list',
  'agreement_signed',
  'board_strength_sheet',
] as const;

export const ADMIN_FILE_SOURCES = [
  'job_attachment',
  'shipment_label',
  'shipment_packing_list',
  'agreement_signed',
  'board_strength_sheet',
  'inspection_attachment',
  'claim_attachment',
  'rfq_attachment',
  'company_attachment',
  'factory_attachment',
  'price_proposal_attachment',
  'discount_memo_attachment',
  'sample_attachment',
  'design_service_attachment',
  'vendor_invoice_attachment',
  'close_task_attachment',
  'other_attachment',
  'vendor_invoice',
  'wht_certificate',
  'payout_remittance',
  'customer_document',
  'customer_wht_certificate',
  'company_statement',
  'quote',
  'slip',
  'conversation_file',
  'agreement_template',
  'structural_request_file',
  'structural_request_delivery',
  'style_intake',
] as const;

export const FILE_SOURCES = [...new Set([...PARTNER_FILE_SOURCES, ...ADMIN_FILE_SOURCES])] as const;
export type FileSource = (typeof FILE_SOURCES)[number];

export type SearchSurface = 'admin' | 'partner';
