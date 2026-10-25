import { type RetentionClass } from '@collective/documents';
import { type FilePurpose } from '@platform/files/file-purposes';

/**
 * Storage metering settings (D-436, Collective D-276 / D-279). Every number is a setting with effective dates, per
 * account type, edited by the platform admin (Superadmin) — never a constant in code. The free allowance starts at
 * 5 GB for every type; the price per GB-month and the add-on packs stay empty until the admin sets them (null price =
 * overage not sold: only optional uploads are then held).
 */
export const STORAGE_ACCOUNT_TYPES = ['factory', 'partner'] as const;
export type StorageAccountType = (typeof STORAGE_ACCOUNT_TYPES)[number];

/** `{ factory: "5", partner: "5" }` — a decimal string (GB or baht) or null per account type. */
export type PerAccountType = Record<StorageAccountType, string | null>;

export interface StoragePackSetting {
  /** Slug, stable: the key a purchase refers to. */
  key: string;
  /** Size in GB, decimal string. */
  gb: string;
  /** Monthly price in baht, decimal string. */
  monthlyPrice: string;
}

const DECIMAL = '^\\d{1,6}(\\.\\d{1,4})?$';
const perType = {
  type: 'object',
  additionalProperties: false,
  required: [...STORAGE_ACCOUNT_TYPES],
  properties: Object.fromEntries(
    STORAGE_ACCOUNT_TYPES.map((t) => [
      t,
      { anyOf: [{ type: 'string', pattern: DECIMAL }, { type: 'null' }] },
    ]),
  ),
};

/** JSON schemas of the settings (`settings.value_schema`): the admin console cannot save a malformed value. */
export const STORAGE_SETTING_SCHEMAS = {
  'storage.free_gb': perType,
  'storage.price_per_gb_month': perType,
  'storage.packs': {
    type: 'array',
    maxItems: 20,
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['key', 'gb', 'monthlyPrice'],
      properties: {
        key: { type: 'string', pattern: '^[a-z0-9_-]{1,40}$' },
        gb: { type: 'string', pattern: DECIMAL },
        monthlyPrice: { type: 'string', pattern: DECIMAL },
      },
    },
  },
  'storage.record_bytes': {
    type: 'object',
    required: ['_default'],
    additionalProperties: { type: 'integer', minimum: 0, maximum: 10_000_000 },
  },
  'storage.notice_at_percent': {
    type: 'array',
    minItems: 1,
    maxItems: 5,
    items: { type: 'integer', minimum: 1, maximum: 1000 },
  },
} as const;

/**
 * Records a factory stores in its own getpack ERP, by counted type → table. Each counts at a fixed size
 * (`storage.record_bytes`), so the bill is predictable and auditable without measuring the database. Getpack's own
 * records about a factory (jobs, payouts, statements) are never counted.
 */
export const COUNTED_RECORDS = {
  quotation: 'erp_quotations',
  sales_order: 'erp_sales_orders',
  delivery_note: 'erp_delivery_notes',
  sales_invoice: 'erp_sales_invoices',
  sales_note: 'erp_sales_notes',
  receipt: 'erp_customer_receipts',
  billing_note: 'erp_billing_notes',
  wht_certificate: 'erp_wht_certificates',
  purchase_order: 'erp_purchase_orders',
  goods_receipt: 'erp_goods_receipts',
  supplier_invoice: 'erp_supplier_invoices',
  supplier_payment: 'erp_supplier_payments',
  production_order: 'erp_production_orders',
  quality_check: 'erp_quality_checks',
  ncr: 'erp_ncrs',
  journal_entry: 'erp_gl_journal_entries',
  stock_movement: 'erp_stock_movements',
  item: 'erp_items',
  trading_partner: 'erp_trading_partners',
  document: 'erp_docs',
} as const;
export type CountedRecordType = keyof typeof COUNTED_RECORDS;

/** Recommended counted sizes in bytes (Collective D-276 "e.g. 2 KB"); `_default` for a type not listed. */
export const DEFAULT_RECORD_BYTES: Record<CountedRecordType | '_default', number> = {
  _default: 1024,
  quotation: 2048,
  sales_order: 2048,
  delivery_note: 2048,
  sales_invoice: 2048,
  sales_note: 2048,
  receipt: 2048,
  billing_note: 2048,
  wht_certificate: 2048,
  purchase_order: 2048,
  goods_receipt: 2048,
  supplier_invoice: 2048,
  supplier_payment: 1024,
  production_order: 2048,
  quality_check: 2048,
  ncr: 2048,
  journal_entry: 1024,
  stock_movement: 256,
  item: 1024,
  trading_partner: 1024,
  document: 1024,
};

export const FREE_GB_DEFAULT: PerAccountType = { factory: '5', partner: '5' };
export const NOT_SET: PerAccountType = { factory: null, partner: null };

/**
 * Admission class of each upload purpose (D-436): legal documents are always stored, operational files of a job are
 * accepted even when the account is full (the overage is billed), optional uploads are held only while the account
 * would be over its allowance and overage is not sold. Data is never deleted or locked for being over.
 */
export const PURPOSE_RETENTION: Record<FilePurpose, RetentionClass> = {
  document: 'legal',
  slip: 'legal',
  brand_mark: 'legal',
  signature: 'legal',
  artwork: 'operational',
  proof: 'operational',
  evidence: 'operational',
  dieline: 'operational',
  import: 'operational',
  image: 'optional',
  avatar: 'optional',
  design_asset: 'optional',
};
