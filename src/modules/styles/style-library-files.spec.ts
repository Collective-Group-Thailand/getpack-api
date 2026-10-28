import { Readable } from 'node:stream';

import { SettingNotFoundError } from '@platform/settings/settings.service';

import { EMPTY_STYLE_LIBRARY_CONTENT } from './style-library-content';
import { StyleLibrarySettingsService } from './style-library-settings.service';

const ID = (n: number) => `0192f3a0-7c1e-7d2a-9b1f-00000000d00${n}`;
const IMG = (n: number) => `/v1/store/catalog/images/${ID(n)}`;
const DOC = (n: number) => `/v1/store/style-library/documents/${ID(n)}`;
const T = { th: 'ใบรับรอง', en: null };

type File = {
  publicId: string;
  uploadStatus: string;
  scanStatus: string;
  purgedAt: Date | null;
  mimeType: string;
  purpose: string | null;
  storageKey: string;
  sizeBytes: bigint;
  sha256: null;
  metadataStrippedAt: Date | null;
};
const file = (n: number, over: Partial<File> = {}): File => ({
  publicId: ID(n),
  uploadStatus: 'uploaded',
  scanStatus: 'clean',
  purgedAt: null,
  mimeType: 'image/png',
  purpose: 'image',
  storageKey: `k${n}`,
  sizeBytes: 10n,
  sha256: null,
  metadataStrippedAt: new Date('2026-10-28T00:00:00Z'),
  ...over,
});

function harness(files: File[], stored: unknown = null) {
  const changes: unknown[] = [];
  const prisma = {
    fileObject: {
      findMany: ({ where }: { where: { publicId: { in: string[] } } }) =>
        Promise.resolve(files.filter((f) => where.publicId.in.includes(f.publicId))),
      findFirst: ({
        where,
      }: {
        where: { publicId: string; uploadStatus: string; scanStatus: string; purpose: { in: string[] } };
      }) =>
        Promise.resolve(
          files.find(
            (f) =>
              f.publicId === where.publicId &&
              f.uploadStatus === where.uploadStatus &&
              f.scanStatus === where.scanStatus &&
              f.purgedAt === null &&
              where.purpose.in.includes(f.purpose ?? '') &&
              f.metadataStrippedAt !== null,
          ) ?? null,
        ),
    },
    setting: { findFirst: () => Promise.resolve(null) },
  };
  const settings = {
    at: () =>
      stored === null
        ? Promise.reject(new SettingNotFoundError('storefront.style_library', new Date()))
        : Promise.resolve({ value: stored, versionNo: 1, effectiveFrom: new Date() }),
  };
  const service = new StyleLibrarySettingsService(
    prisma as never,
    settings as never,
    {
      changeFromEditor: (_a: unknown, _k: unknown, v: unknown) => (changes.push(v), Promise.resolve()),
    } as never,
    { getStream: (key: string) => Promise.resolve(Readable.from([key])) } as never,
  );
  return { service, changes };
}

const actor = { type: 'user', userId: 1n } as never;
const content = (trust: Partial<typeof EMPTY_STYLE_LIBRARY_CONTENT.trust>) => ({
  ...EMPTY_STYLE_LIBRARY_CONTENT,
  trust: { ...EMPTY_STYLE_LIBRARY_CONTENT.trust, ...trust },
});

describe('trust-section files (C1e, DECISIONS-STAGE-A §13.3)', () => {
  it('saves uploaded pictures and documents, and external https links for documents', async () => {
    const h = harness([file(1), file(2, { mimeType: 'application/pdf', purpose: 'published_document' })]);
    await h.service.update(actor, {
      content: content({
        productionPhotos: [{ url: IMG(1), alt: T }],
        certifications: [
          { title: T, number: null, issuer: null, expiresOn: null, documentUrl: DOC(2) },
          {
            title: T,
            number: null,
            issuer: null,
            expiresOn: null,
            documentUrl: 'https://issuer.example/c.pdf',
          },
        ],
      }),
      reason: 'ใบรับรองจริง',
    });
    expect(h.changes).toHaveLength(1);
  });

  it.each([
    ['missing', [] as File[]],
    ['infected', [file(1, { scanStatus: 'infected' })]],
    ['not uploaded', [file(1, { uploadStatus: 'pending' })]],
    ['a document, not a picture', [file(1, { mimeType: 'application/pdf', purpose: 'published_document' })]],
    ['customer artwork', [file(1, { purpose: 'artwork' })]],
  ])('refuses a picture that is %s', async (_why, files) => {
    const h = harness(files);
    await expect(
      h.service.update(actor, {
        content: content({ customerLogos: [{ name: 'ร้าน', logoUrl: IMG(1), permission: 'อีเมล' }] }),
        reason: 'โลโก้',
      }),
    ).rejects.toMatchObject({
      code: 'validation.failed',
      errors: [expect.objectContaining({ path: 'content.trust.customerLogos.0.logoUrl', code: 'fileReady' })],
    });
    expect(h.changes).toHaveLength(0);
  });

  it('serves a published document and nothing else', async () => {
    const stored = content({
      certifications: [
        { title: T, number: null, issuer: null, expiresOn: '2000-01-01', documentUrl: DOC(3) },
        { title: T, number: null, issuer: null, expiresOn: null, documentUrl: DOC(2) },
      ],
    });
    const h = harness(
      [
        file(2, { mimeType: 'application/pdf', purpose: 'published_document' }),
        file(3, { mimeType: 'application/pdf' }),
      ],
      stored,
    );
    const doc = await h.service.document(ID(2));
    expect(doc.mimeType).toBe('application/pdf');
    // Expired certificate: not published, not served. Unreferenced: not served.
    await expect(h.service.document(ID(3))).rejects.toMatchObject({ code: 'http.not_found' });
    await expect(h.service.document(ID(4))).rejects.toMatchObject({ code: 'http.not_found' });
    await expect(harness([file(2)]).service.document(ID(2))).rejects.toMatchObject({
      code: 'http.not_found',
    });
  });

  it('refuses a document uploaded as a financial-record document, and never serves one (C1f, §14.3)', async () => {
    const pdf = { mimeType: 'application/pdf', purpose: 'document' };
    const h = harness([file(5, pdf)]);
    await expect(
      h.service.update(actor, {
        content: content({
          foodGrade: [{ title: T, documentUrl: DOC(5) }],
        }),
        reason: 'เอกสาร food grade',
      }),
    ).rejects.toMatchObject({
      code: 'validation.failed',
      errors: [expect.objectContaining({ path: 'content.trust.foodGrade.0.documentUrl', code: 'fileReady' })],
    });
    const published = content({ foodGrade: [{ title: T, documentUrl: DOC(5) }] });
    await expect(harness([file(5, pdf)], published).service.document(ID(5))).rejects.toMatchObject({
      code: 'http.not_found',
    });
    // Published purpose but its metadata could not be stripped (yet): not served either.
    await expect(
      harness(
        [file(5, { ...pdf, purpose: 'published_document', metadataStrippedAt: null })],
        published,
      ).service.document(ID(5)),
    ).rejects.toMatchObject({ code: 'http.not_found' });
    const ok = await harness(
      [file(5, { ...pdf, purpose: 'published_document' })],
      published,
    ).service.document(ID(5));
    expect(ok.mimeType).toBe('application/pdf');
  });
});
