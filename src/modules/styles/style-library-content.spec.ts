import { settingValueError } from '@platform/settings/setting-value';

import {
  contentOf,
  EMPTY_STYLE_LIBRARY_CONTENT,
  publicContent,
  STYLE_LIBRARY_CONTENT_SCHEMA,
  type StyleLibraryContent,
} from './style-library-content';
import { normalise } from './style-library-settings.service';

const SCHEMA = STYLE_LIBRARY_CONTENT_SCHEMA as unknown as Record<string, unknown>;
const T = { th: 'ใบรับรอง', en: null };

const filled: StyleLibraryContent = {
  ...EMPTY_STYLE_LIBRARY_CONTENT,
  trust: {
    certifications: [
      { title: T, number: 'X-1', issuer: 'Issuer', expiresOn: '2026-10-27', documentUrl: 'https://example.invalid/a.pdf' },
      { title: T, number: null, issuer: null, expiresOn: '2026-10-28', documentUrl: null },
      { title: T, number: null, issuer: null, expiresOn: null, documentUrl: '/docs/c.pdf' },
    ],
    foodGrade: [],
    productionPhotos: [{ url: '/v1/store/catalog/images/x', alt: T }],
    customerLogos: [{ name: 'ร้าน', logoUrl: 'https://example.invalid/l.svg', permission: 'email 2026-10-01' }],
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
    expect(pub.trust.customerLogos).toEqual([{ name: 'ร้าน', logoUrl: 'https://example.invalid/l.svg' }]);
  });

  it('validates against the setting schema', () => {
    expect(settingValueError('json', filled, SCHEMA)).toBeNull();
    expect(settingValueError('json', EMPTY_STYLE_LIBRARY_CONTENT, SCHEMA)).toBeNull();
    const badUrl = { ...filled, trust: { ...filled.trust, productionPhotos: [{ url: 'http://x', alt: T }] } };
    expect(settingValueError('json', badUrl, SCHEMA)).not.toBeNull();
    const noPermission = {
      ...filled,
      trust: { ...filled.trust, customerLogos: [{ name: 'a', logoUrl: '/l.svg' }] },
    };
    expect(settingValueError('json', noPermission, SCHEMA)).not.toBeNull();
  });

  it('normalises an editor save to the stored shape', () => {
    const saved = normalise({
      quickSearch: [{ label: { th: ' กล่อง ', en: '' }, query: ' กล่อง ' }],
      materialSwatches: [],
      trust: {
        certifications: [{ title: { th: 'FSC', en: undefined } as never, number: ' ', issuer: undefined, expiresOn: undefined, documentUrl: undefined } as never],
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
