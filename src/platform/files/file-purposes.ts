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
  /** Images, logos, SVGs and fonts placed in an online design (B4.1, U-B0.1). */
  design_asset: {
    retentionClass: 'customer_content',
    maxBytes: 50 * MiB,
    mimeTypes: [...IMAGES, 'image/svg+xml', 'font/ttf', 'font/otf', 'font/woff', 'font/woff2'],
  },
  /** Dieline drawings: partner intake (D-272) and delivered structural designs (D-273). */
  dieline: {
    retentionClass: 'standard',
    maxBytes: 50 * MiB,
    mimeTypes: [...PDF, 'application/dxf', 'image/vnd.dxf', 'image/x-dxf', 'image/svg+xml'],
  },
} as const satisfies Record<string, FilePurposeRule>;

export type FilePurpose = keyof typeof FILE_PURPOSES;
export const FILE_PURPOSE_KEYS = Object.keys(FILE_PURPOSES) as FilePurpose[];

/** Above this size uploads go multipart (S3 limit for one PUT is 5 GiB; big files resume better). */
export const MULTIPART_THRESHOLD = 100 * MiB;
export const MIN_PART_SIZE = 8 * MiB;
export const MAX_PARTS = 1_000;
