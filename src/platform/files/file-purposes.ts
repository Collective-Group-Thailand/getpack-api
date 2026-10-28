import { type FileRetentionClass } from '@generated/prisma/client';

/**
 * What an upload is for decides its retention class (schema-design §3.1: financial records ≥ 10
 * years, `accounting-design.md` §2), the accepted types and a size ceiling. Ceilings are technical
 * limits of the upload pipeline, not business values.
 */
export interface FilePurposeRule {
  retentionClass: FileRetentionClass;
  maxBytes: number;
  mimeTypes: readonly string[];
}

const MiB = 1024 * 1024;
const IMAGES = ['image/png', 'image/jpeg', 'image/webp'];
const PDF = ['application/pdf'];

export const FILE_PURPOSES = {
  /** Customer artwork (large print files). */
  artwork: {
    retentionClass: 'customer_content',
    maxBytes: 2048 * MiB,
    mimeTypes: [
      ...PDF,
      ...IMAGES,
      'image/tiff',
      'image/svg+xml',
      'application/postscript',
      'application/illustrator',
      'image/vnd.adobe.photoshop',
      'application/zip',
    ],
  },
  /** Proofs and mock-up renders. */
  proof: { retentionClass: 'customer_content', maxBytes: 500 * MiB, mimeTypes: [...PDF, ...IMAGES] },
  /** Bank-transfer slips (D-061). */
  slip: { retentionClass: 'financial_record', maxBytes: 10 * MiB, mimeTypes: [...PDF, ...IMAGES] },
  /** Photos and documents as evidence: KYC, milestones, QC, claims, site visits, memos. */
  evidence: {
    retentionClass: 'standard',
    maxBytes: 100 * MiB,
    mimeTypes: [...PDF, ...IMAGES, 'video/mp4', 'video/quicktime'],
  },
  /** Accounting and legal documents (tax invoices from factories, agreements). */
  document: { retentionClass: 'financial_record', maxBytes: 50 * MiB, mimeTypes: [...PDF, ...IMAGES] },
  /** Spreadsheet imports (catalogue, geography — D-005 Excel import tools) and style library JSON (D-411). */
  import: {
    retentionClass: 'transient',
    maxBytes: 20 * MiB,
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/json',
    ],
  },
  avatar: { retentionClass: 'standard', maxBytes: 5 * MiB, mimeTypes: IMAGES },
  /**
   * Images getpack publishes (D-415): catalogue and stock product photos, CMS covers and photos,
   * studio template thumbnails. Standard retention — not the financial-record years of `document`.
   */
  image: { retentionClass: 'standard', maxBytes: 20 * MiB, mimeTypes: IMAGES },
  /**
   * C1f (owner 2026-10-28 13:58, DECISIONS-STAGE-A §14.3): documents getpack publishes to everyone — the style
   * library's trust-section certificates and food-grade documents. Their metadata (PDF Info / XMP, EXIF) is stripped
   * like published images before anyone can read them; standard retention (not a financial record).
   */
  published_document: { retentionClass: 'standard', maxBytes: 50 * MiB, mimeTypes: [...PDF, ...IMAGES] },
  /** Images, logos, SVGs and fonts placed in an online design (B4.1, U-B0.1). */
  design_asset: {
    retentionClass: 'customer_content',
    maxBytes: 50 * MiB,
    mimeTypes: [...IMAGES, 'image/svg+xml', 'font/ttf', 'font/otf', 'font/woff', 'font/woff2'],
  },
  /** D-428: a logo or company seal for documents (re-encoded as PNG before use). */
  brand_mark: { retentionClass: 'financial_record', maxBytes: 10 * MiB, mimeTypes: IMAGES },
  /** D-429: a signatory's own signature for documents (re-encoded, paper made transparent). */
  signature: { retentionClass: 'financial_record', maxBytes: 10 * MiB, mimeTypes: IMAGES },
  /** Dieline drawings: partner intake (D-272) and delivered structural designs (D-273). */
  dieline: {
    retentionClass: 'standard',
    maxBytes: 50 * MiB,
    mimeTypes: [...PDF, 'application/dxf', 'image/vnd.dxf', 'image/x-dxf', 'image/svg+xml'],
  },
} as const satisfies Record<string, FilePurposeRule>;

export type FilePurpose = keyof typeof FILE_PURPOSES;

/**
 * D-442 (GLOBAL-RULES §1): uploads shared with customers or production whose identifying metadata (EXIF / GPS, XMP,
 * PDF Info) the worker removes before the file can be downloaded — QC / milestone / POD / claim photos and reports,
 * proofs, published images and documents (C1f), avatars, dielines. Customer originals (`artwork`, `design_asset`) are kept as uploaded
 * (production gets a scrubbed copy, `artwork_production_copies`); financial records (`slip`, `document`,
 * `brand_mark`, `signature`) and imports are never rewritten.
 */
export const SCRUBBED_PURPOSES: ReadonlySet<string> = new Set<FilePurpose>([
  'evidence',
  'proof',
  'image',
  'published_document',
  'avatar',
  'dieline',
]);
export const FILE_PURPOSE_KEYS = Object.keys(FILE_PURPOSES) as FilePurpose[];

/** Above this size uploads go multipart (S3 limit for one PUT is 5 GiB; big files resume better). */
export const MULTIPART_THRESHOLD = 100 * MiB;
export const MIN_PART_SIZE = 8 * MiB;
export const MAX_PARTS = 1_000;
