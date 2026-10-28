/**
 * C1c (owner decision 2026-10-28, DECISIONS-STAGE-A §11.5): the style library page's staff-managed content — the
 * "ค้นหาบ่อย" terms, material swatches and the trust section (certificates with number / issuer / expiry, food-grade
 * documents, production-process photos, customer logos the customer permitted, the tax-invoice note). Kept in the
 * effective-dated, audited setting `storefront.style_library` (owner Marketing; edited from the back office with
 * `styles.curate` = Admin and Marketing, D-246). Empty by default: nothing here is invented, each part is hidden on the
 * storefront until staff enter it. Pure.
 */

export const STYLE_LIBRARY_SETTING = 'storefront.style_library';

export interface Localised {
  th: string;
  en: string | null;
}

export interface StyleLibraryContent {
  quickSearch: { label: Localised; query: string }[];
  materialSwatches: { materialClass: string; colour: string | null; imageUrl: string | null }[];
  trust: {
    certifications: {
      title: Localised;
      number: string | null;
      issuer: string | null;
      /** Last valid day (YYYY-MM-DD, Asia/Bangkok); an expired certificate is not shown to customers. */
      expiresOn: string | null;
      documentUrl: string | null;
    }[];
    foodGrade: { title: Localised; documentUrl: string | null }[];
    productionPhotos: { url: string; alt: Localised }[];
    /** Only logos the customer agreed to show; `permission` = where that consent is recorded (staff only). */
    customerLogos: { name: string; logoUrl: string; permission: string }[];
    taxInvoiceNote: Localised | null;
  };
}

export const EMPTY_STYLE_LIBRARY_CONTENT: StyleLibraryContent = {
  quickSearch: [],
  materialSwatches: [],
  trust: { certifications: [], foodGrade: [], productionPhotos: [], customerLogos: [], taxInvoiceNote: null },
};

/** An https link or a path on getpack's own site (C1c; C1e narrows images and documents below). */
export const CONTENT_URL_PATTERN = '^(https://[^\\s]+|/[^\\s]*)$';

/**
 * C1e (owner decision 2026-10-28 12:07, DECISIONS-STAGE-A §13.3): pictures (production photos, customer logos,
 * material swatches) are files uploaded through the file service (purpose `image`, D-415) and served by the public
 * catalogue image route while the content in force references them; documents (certificates, food-grade documents)
 * are uploaded files (C1f, §14.3: purpose `published_document` — metadata stripped like images — or `image`) served by
 * `store.styleLibrary.getDocument`, or — documents only — an external https link.
 */
export const STYLE_LIBRARY_IMAGE_PREFIX = '/v1/store/catalog/images/';
export const STYLE_LIBRARY_DOCUMENT_PREFIX = '/v1/store/style-library/documents/';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const IMAGE_URL_PATTERN = `^/v1/store/catalog/images/${UUID}$`;
export const DOCUMENT_URL_PATTERN = `^(https://[^\\s]+|/v1/store/style-library/documents/${UUID})$`;

const text = (max: number) => ({ type: 'string', minLength: 1, maxLength: max });
const nullableText = (max: number) => ({ type: ['string', 'null'], minLength: 1, maxLength: max });
const imageUrl = { type: 'string', pattern: IMAGE_URL_PATTERN, maxLength: 2000 };
const nullableImageUrl = { type: ['string', 'null'], pattern: IMAGE_URL_PATTERN, maxLength: 2000 };
const nullableDocumentUrl = { type: ['string', 'null'], pattern: DOCUMENT_URL_PATTERN, maxLength: 2000 };
const localised = {
  type: 'object',
  additionalProperties: false,
  required: ['th', 'en'],
  properties: { th: text(500), en: nullableText(500) },
};

/** The setting's JSON Schema (validated on every change by the settings platform). */
export const STYLE_LIBRARY_CONTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['quickSearch', 'materialSwatches', 'trust'],
  properties: {
    quickSearch: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'query'],
        properties: { label: localised, query: text(120) },
      },
    },
    materialSwatches: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['materialClass', 'colour', 'imageUrl'],
        properties: {
          materialClass: { type: 'string', pattern: '^[a-z][a-z0-9_]*$', maxLength: 40 },
          colour: { type: ['string', 'null'], pattern: '^#[0-9A-Fa-f]{6}$' },
          imageUrl: nullableImageUrl,
        },
      },
    },
    trust: {
      type: 'object',
      additionalProperties: false,
      required: ['certifications', 'foodGrade', 'productionPhotos', 'customerLogos', 'taxInvoiceNote'],
      properties: {
        certifications: {
          type: 'array',
          maxItems: 20,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'number', 'issuer', 'expiresOn', 'documentUrl'],
            properties: {
              title: localised,
              number: nullableText(120),
              issuer: nullableText(200),
              expiresOn: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
              documentUrl: nullableDocumentUrl,
            },
          },
        },
        foodGrade: {
          type: 'array',
          maxItems: 20,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'documentUrl'],
            properties: { title: localised, documentUrl: nullableDocumentUrl },
          },
        },
        productionPhotos: {
          type: 'array',
          maxItems: 24,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['url', 'alt'],
            properties: { url: imageUrl, alt: localised },
          },
        },
        customerLogos: {
          type: 'array',
          maxItems: 40,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'logoUrl', 'permission'],
            properties: { name: text(120), logoUrl: imageUrl, permission: text(300) },
          },
        },
        taxInvoiceNote: { oneOf: [{ type: 'null' }, localised] },
      },
    },
  },
} as const;

/** The stored value, or the empty content when it is unset or not an object (never fails the storefront). */
export function contentOf(value: unknown): StyleLibraryContent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_STYLE_LIBRARY_CONTENT;
  const v = value as Partial<StyleLibraryContent>;
  const trust = (v.trust ?? {}) as Partial<StyleLibraryContent['trust']>;
  return {
    quickSearch: Array.isArray(v.quickSearch) ? v.quickSearch : [],
    materialSwatches: Array.isArray(v.materialSwatches) ? v.materialSwatches : [],
    trust: {
      certifications: Array.isArray(trust.certifications) ? trust.certifications : [],
      foodGrade: Array.isArray(trust.foodGrade) ? trust.foodGrade : [],
      productionPhotos: Array.isArray(trust.productionPhotos) ? trust.productionPhotos : [],
      customerLogos: Array.isArray(trust.customerLogos) ? trust.customerLogos : [],
      taxInvoiceNote: trust.taxInvoiceNote ?? null,
    },
  };
}

/** D-246: styles compared side by side (a decision value, not a setting). */
export const COMPARE_LIMIT = 3;

/**
 * What customers see: certificates whose `expiresOn` is before `today` (Asia/Bangkok date) are left out; the staff-only
 * consent reference of a logo is never published.
 */
export function publicContent(content: StyleLibraryContent, today: string) {
  return {
    quickSearch: content.quickSearch,
    compareLimit: COMPARE_LIMIT,
    materialSwatches: content.materialSwatches,
    trust: {
      certifications: content.trust.certifications
        .filter((c) => c.expiresOn === null || c.expiresOn >= today)
        .map((c) => ({
          title: c.title,
          number: c.number,
          issuer: c.issuer,
          expiresOn: c.expiresOn,
          documentUrl: c.documentUrl,
        })),
      foodGrade: content.trust.foodGrade,
      productionPhotos: content.trust.productionPhotos,
      customerLogos: content.trust.customerLogos.map(({ name, logoUrl }) => ({ name, logoUrl })),
      taxInvoiceNote: content.trust.taxInvoiceNote,
    },
  };
}

/** C1e: the uploaded file a content path points at (`/v1/store/…/<fileId>`), or null for an external link. */
export function fileIdOf(url: string | null | undefined, prefix: string): string | null {
  if (!url || !url.startsWith(prefix)) return null;
  const id = url.slice(prefix.length);
  return new RegExp(`^${UUID}$`).test(id) ? id : null;
}

/** C1e: every uploaded file the content references, by kind, with the path of the field that holds it. */
export function referencedFiles(
  content: StyleLibraryContent,
): { kind: 'image' | 'document'; fileId: string; path: string }[] {
  const out: { kind: 'image' | 'document'; fileId: string; path: string }[] = [];
  const image = (url: string | null, path: string) => {
    const fileId = fileIdOf(url, STYLE_LIBRARY_IMAGE_PREFIX);
    if (fileId) out.push({ kind: 'image', fileId, path });
  };
  const document = (url: string | null, path: string) => {
    const fileId = fileIdOf(url, STYLE_LIBRARY_DOCUMENT_PREFIX);
    if (fileId) out.push({ kind: 'document', fileId, path });
  };
  content.materialSwatches.forEach((m, i) => image(m.imageUrl, `content.materialSwatches.${i}.imageUrl`));
  content.trust.certifications.forEach((c, i) =>
    document(c.documentUrl, `content.trust.certifications.${i}.documentUrl`),
  );
  content.trust.foodGrade.forEach((f, i) =>
    document(f.documentUrl, `content.trust.foodGrade.${i}.documentUrl`),
  );
  content.trust.productionPhotos.forEach((p, i) => image(p.url, `content.trust.productionPhotos.${i}.url`));
  content.trust.customerLogos.forEach((l, i) => image(l.logoUrl, `content.trust.customerLogos.${i}.logoUrl`));
  return out;
}

/**
 * C1e: the uploaded files customers may open — those the published content references (an expired certificate's
 * document is not published, so it is not served either).
 */
export function publicFileIds(
  content: StyleLibraryContent,
  today: string,
): { images: string[]; documents: string[] } {
  const shown = publicContent(content, today);
  const ids = (urls: (string | null)[], prefix: string) => [
    ...new Set(urls.map((u) => fileIdOf(u, prefix)).filter((id): id is string => id !== null)),
  ];
  return {
    images: ids(
      [
        ...shown.materialSwatches.map((m) => m.imageUrl),
        ...shown.trust.productionPhotos.map((p) => p.url),
        ...shown.trust.customerLogos.map((l) => l.logoUrl),
      ],
      STYLE_LIBRARY_IMAGE_PREFIX,
    ),
    documents: ids(
      [
        ...shown.trust.certifications.map((c) => c.documentUrl),
        ...shown.trust.foodGrade.map((f) => f.documentUrl),
      ],
      STYLE_LIBRARY_DOCUMENT_PREFIX,
    ),
  };
}
