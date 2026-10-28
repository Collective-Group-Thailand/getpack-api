import { settingValueError } from '@platform/settings/setting-value';

import {
  contentOf,
  EMPTY_STYLE_LIBRARY_CONTENT,
  fileIdOf,
  publicContent,
  publicFileIds,
  referencedFiles,
  STYLE_LIBRARY_CONTENT_SCHEMA,
  type StyleLibraryContent,
} from './style-library-content';
import { normalise } from './style-library-settings.service';

const SCHEMA = STYLE_LIBRARY_CONTENT_SCHEMA as unknown as Record<string, unknown>;
const T = { th: 'ใบรับรอง', en: null };
const ID = (n: number) => `0192f3a0-7c1e-7d2a-9b1f-00000000d00${n}`;
const IMG = (n: number) => `/v1/store/catalog/images/${ID(n)}`;
const DOC = (n: number) => `/v1/store/style-library/documents/${ID(n)}`;

const filled: StyleLibraryContent = {
  ...EMPTY_STYLE_LIBRARY_CONTENT,
  trust: {
    certifications: [
      { title: T, number: 'X-1', issuer: 'Issuer', expiresOn: '2026-10-27', documentUrl: DOC(1) },
      { title: T, number: null, issuer: null, expiresOn: '2026-10-28', documentUrl: null },
      { title: T, number: null, issuer: null, expiresOn: null, documentUrl: 'https://example.invalid/c.pdf' },
    ],
    foodGrade: [{ title: T, documentUrl: DOC(2) }],
    productionPhotos: [{ url: IMG(3), alt: T }],
    customerLogos: [{ name: 'ร้าน', logoUrl: IMG(4), permission: 'email 2026-10-01' }],
    taxInvoiceNote: { th: 'ใบกำกับภาษีเต็มรูปแบบ', en: null },
  },
};

describe('style library content (C1c, DECISIONS-STAGE-A §11.5)', () => {
  it('is empty while unset or malformed', () => {
    expect(contentOf(null)).toEqual(EMPTY_STYLE_LIBRARY_CONTENT);
    expect(contentOf([])).toEqual(EMPTY_STYLE_LIBRARY_CONTENT);
    expect(publicContent(contentOf(undefined), '2026-10-28').compareLimit).toBe(3);
  });

  it('leaves out expired certificates and never publishes a logo permission', () => {
    const pub = publicContent(filled, '2026-10-28');
    expect(pub.trust.certifications.map((c) => c.expiresOn)).toEqual(['2026-10-28', null]);
    expect(pub.trust.customerLogos).toEqual([{ name: 'ร้าน', logoUrl: IMG(4) }]);
  });

  it('validates against the setting schema', () => {
    expect(settingValueError('json', filled, SCHEMA)).toBeNull();
    expect(settingValueError('json', EMPTY_STYLE_LIBRARY_CONTENT, SCHEMA)).toBeNull();
    const badUrl = { ...filled, trust: { ...filled.trust, productionPhotos: [{ url: 'http://x', alt: T }] } };
    expect(settingValueError('json', badUrl, SCHEMA)).not.toBeNull();
    // C1e (§13.3): pictures are uploaded files only — no https link, no other site path.
    const linkedPhoto = {
      ...filled,
      trust: { ...filled.trust, productionPhotos: [{ url: 'https://x.invalid/p.jpg', alt: T }] },
    };
    expect(settingValueError('json', linkedPhoto, SCHEMA)).not.toBeNull();
    const sitePathDoc = {
      ...filled,
      trust: { ...filled.trust, foodGrade: [{ title: T, documentUrl: '/docs/a.pdf' }] },
    };
    expect(settingValueError('json', sitePathDoc, SCHEMA)).not.toBeNull();
    const noPermission = {
      ...filled,
      trust: { ...filled.trust, customerLogos: [{ name: 'a', logoUrl: IMG(5) }] },
    };
    expect(settingValueError('json', noPermission, SCHEMA)).not.toBeNull();
  });

  it('normalises an editor save to the stored shape', () => {
    const saved = normalise({
      quickSearch: [{ label: { th: ' กล่อง ', en: '' }, query: ' กล่อง ' }],
      materialSwatches: [],
      trust: {
        certifications: [
          {
            title: { th: 'FSC', en: undefined } as never,
            number: ' ',
            issuer: undefined,
            expiresOn: undefined,
            documentUrl: undefined,
          } as never,
        ],
        foodGrade: [],
        productionPhotos: [],
        customerLogos: [],
        taxInvoiceNote: undefined as never,
      },
    });
    expect(saved.quickSearch[0]).toEqual({ label: { th: 'กล่อง', en: null }, query: 'กล่อง' });
    expect(saved.trust.certifications[0]).toEqual({
      title: { th: 'FSC', en: null },
      number: null,
      issuer: null,
      expiresOn: null,
      documentUrl: null,
    });
    expect(saved.trust.taxInvoiceNote).toBeNull();
    expect(settingValueError('json', saved, SCHEMA)).toBeNull();
  });
});

describe('uploaded files in the content (C1e, DECISIONS-STAGE-A §13.3)', () => {
  it('reads a file id only from its own path', () => {
    expect(fileIdOf(IMG(1), '/v1/store/catalog/images/')).toBe(ID(1));
    expect(fileIdOf(DOC(1), '/v1/store/catalog/images/')).toBeNull();
    expect(fileIdOf('https://example.invalid/a.pdf', '/v1/store/style-library/documents/')).toBeNull();
    expect(fileIdOf('/v1/store/catalog/images/not-a-uuid', '/v1/store/catalog/images/')).toBeNull();
  });

  it('lists every referenced upload with its field', () => {
    expect(referencedFiles(filled)).toEqual([
      { kind: 'document', fileId: ID(1), path: 'content.trust.certifications.0.documentUrl' },
      { kind: 'document', fileId: ID(2), path: 'content.trust.foodGrade.0.documentUrl' },
      { kind: 'image', fileId: ID(3), path: 'content.trust.productionPhotos.0.url' },
      { kind: 'image', fileId: ID(4), path: 'content.trust.customerLogos.0.logoUrl' },
    ]);
  });

  it("publishes only what customers see — an expired certificate's document is not served", () => {
    expect(publicFileIds(filled, '2026-10-28')).toEqual({ images: [ID(3), ID(4)], documents: [ID(2)] });
    expect(publicFileIds(filled, '2026-10-27').documents).toEqual([ID(1), ID(2)]);
  });
});
