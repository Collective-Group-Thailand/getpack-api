/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- loose response bodies (see Rec) */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type FakeObjectStorage } from '@integrations/s3/fake-object-storage';
import { OBJECT_STORAGE } from '@integrations/s3/object-storage.port';
import { FileTextIndexJobs } from '@platform/file-search/file-text-index.jobs';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import { as, foldingBackToRfq, foldingReady, staffToken } from '../support/commerce-e2e';
import { bootFulfilmentApp, factoryToken, type FulfilmentApp } from '../support/fulfilment-e2e';

const FIXTURES = join(__dirname, '../fixtures/file-text');

/** The readers need poppler-utils and Tesseract with Thai (installed in CI and the worker image). */
function toolsInstalled(): boolean {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    return execFileSync('tesseract', ['--list-langs'], { encoding: 'utf8' }).split('\n').includes('tha');
  } catch {
    return false;
  }
}

/**
 * D-427 content search (ADR-0013): a factory's documents are read (text layer, Word, OCR of a scan), found by what is
 * written in them — exactly, despite missing Thai marks, and by meaning — only by that factory and only by people who
 * may read documents; older versions and archived documents on request; getpack's own attachments only in the back
 * office, which never sees the factory's ERP files.
 */
(toolsInstalled() ? describe : describe.skip)('content search (e2e, D-427)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let owner: string;
  let base: string;
  type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  jest.setTimeout(300_000);

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 801);
    base = `/v1/partner/factories/${fixture.factoryPublicId}/erp`;
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  /** A clean, uploaded file with real bytes in the fake bucket. */
  async function stored(
    name: string,
    mimeType: string,
    factoryId: bigint | null,
  ): Promise<{ id: bigint; publicId: string }> {
    const body = readFileSync(join(FIXTURES, name));
    const key = `test/${randomUUID()}`;
    ctx.app.get<FakeObjectStorage>(OBJECT_STORAGE).putDirect(key, body, mimeType);
    return ctx.prisma.fileObject.create({
      data: {
        bucket: 'test',
        storageKey: key,
        originalName: name,
        mimeType,
        sizeBytes: body.length,
        uploadStatus: 'uploaded',
        scanStatus: 'clean',
        scannedAt: new Date(),
        retentionClass: 'financial_record',
        ownerFactoryId: factoryId,
      },
      select: { id: true, publicId: true },
    });
  }

  /** Runs the worker's jobs until every queued file is read and embedded. */
  async function index(): Promise<void> {
    const jobs = ctx.app.get(FileTextIndexJobs);
    await jobs.enqueue();
    while ((await jobs.extractPending()) > 0);
    while ((await jobs.embedPending()) > 0);
  }

  const search = async (q: string, extra = '', token = owner) =>
    (
      await as(ctx, token)
        .get(`${base}/file-search?q=${encodeURIComponent(q)}${extra}`)
        .expect(200)
    ).body as Rec;

  it('reads documents and finds them by what is written inside', async () => {
    const factory = await ctx.prisma.factory.findUniqueOrThrow({
      where: { publicId: fixture.factoryPublicId },
    });
    const scan = await stored('lease-scanned.pdf', 'application/pdf', factory.id);
    const word = await stored(
      'spec.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      factory.id,
    );
    const lease = (
      await as(ctx, owner)
        .post(`${base}/documents`, { title: `สัญญา ${ctx.run}`, category: 'contract', fileId: scan.publicId })
        .expect(201)
    ).body;
    const spec = (
      await as(ctx, owner)
        .post(`${base}/documents`, {
          title: `สเปก ${ctx.run}`,
          category: 'specification',
          fileId: word.publicId,
        })
        .expect(201)
    ).body;
    expect(lease.file.text).toMatchObject({ status: 'pending' });

    await index();

    // The scan was read by OCR; its version says so.
    const read = (await as(ctx, owner).get(`${base}/documents/${lease.id}`).expect(200)).body;
    expect(read.versions[0].file.text).toMatchObject({
      status: 'indexed',
      method: 'pdf_ocr',
      ocrPages: 2,
      meaning: true,
    });
    expect(read.versions[0].file.text.ocrConfidence).toBeGreaterThan(60);

    // Exact phrase (typed with ำ; OCR read ํา), highlighted, on page 1.
    const exact = await search('เลขประจำตัวผู้เสียภาษี 0105561234567');
    const hit = exact.data.find((h: Rec) => h.file.id === scan.publicId);
    expect(hit).toMatchObject({
      exact: true,
      usages: [{ source: 'erp_doc', subjectId: lease.id, current: true }],
    });
    expect(hit.matches[0]).toMatchObject({ page: 1, ocr: true, by: 'keyword' });
    const [a, b] = hit.matches[0].highlights[0];
    expect(hit.matches[0].snippet.slice(a, b).replace(/\s/g, '')).toContain('0105561234567');
    expect(exact.meta).toMatchObject({ meaning: true, indexing: { pending: 0, failed: 0 } });

    // English on page 2, and a Thai phrase typed without its tone marks still finds the scan (not exact).
    expect((await search('ninety (90) days')).data[0]).toMatchObject({ file: { id: scan.publicId } });
    const close = await search('ค่าเชาเครืองพิมพ');
    expect(close.data.map((h: Rec) => h.file.id)).toContain(scan.publicId);

    // Word: a table cell and the header.
    const fromWord = await search('4.5 kN/m');
    expect(fromWord.data[0]).toMatchObject({ file: { id: word.publicId }, usages: [{ subjectId: spec.id }] });
    expect((await search('QF-07')).data[0].file.id).toBe(word.publicId);
    // Keyword only / meaning only.
    expect((await search('QF-07', '&mode=keyword')).data[0].matches[0].by).toBe('keyword');
    expect(
      (await search('QF-07', '&mode=meaning')).data.every((h: Rec) =>
        h.matches.every((m: Rec) => m.by === 'meaning'),
      ),
    ).toBe(true);

    // A new version replaces the old one in results; older versions on request.
    const text = await stored('lease-text.pdf', 'application/pdf', factory.id);
    await as(ctx, owner)
      .post(`${base}/documents/${lease.id}/versions`, { fileId: text.publicId })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    await index();
    const current = await search('CT-2569-0142');
    expect(current.data.map((h: Rec) => h.file.id)).toEqual(expect.arrayContaining([text.publicId]));
    expect(current.data.map((h: Rec) => h.file.id)).not.toContain(scan.publicId);
    const all = await search('CT-2569-0142', '&allVersions=true');
    expect(all.data.map((h: Rec) => h.file.id)).toEqual(
      expect.arrayContaining([text.publicId, scan.publicId]),
    );
    expect(all.data.find((h: Rec) => h.file.id === text.publicId).text.method).toBe('pdf_text');

    // Archived documents only on request.
    const etag = (await as(ctx, owner).get(`${base}/documents/${spec.id}`).expect(200)).headers
      .etag as string;
    await as(ctx, owner)
      .patch(`${base}/documents/${spec.id}`, { status: 'archived' })
      .set('If-Match', etag)
      .expect(200);
    expect((await search('QF-07')).data.map((h: Rec) => h.file.id)).not.toContain(word.publicId);
    expect((await search('QF-07', '&archived=true')).data.map((h: Rec) => h.file.id)).toContain(
      word.publicId,
    );

    // Too short a query is refused.
    await as(ctx, owner).get(`${base}/file-search?q=a`).expect(422);
  });

  it('shows a factory its own files only, and only to people who may read documents', async () => {
    // Another factory's owner sees none of them.
    const other = await ctx.prisma.factory.findFirst({
      where: { publicId: { not: fixture.factoryPublicId }, status: 'active' },
    });
    if (other) {
      const otherOwner = await factoryToken(ctx, other.publicId, 'factory_owner', 802);
      const res = await as(ctx, otherOwner)
        .get(
          `/v1/partner/factories/${other.publicId}/erp/file-search?q=${encodeURIComponent('CT-2569-0142')}`,
        )
        .expect(200);
      expect(res.body.data).toEqual([]);
    }
    // Someone from this factory without `factory_documents.read` is refused.
    const shipping = await factoryToken(ctx, fixture.factoryPublicId, 'factory_shipping', 803);
    await as(ctx, shipping).get(`${base}/file-search?q=CT-2569`).expect(403);
  });

  it('searches getpack’s own attachments in the back office, never a factory’s ERP files', async () => {
    const file = await stored('lease-photo.jpg', 'image/jpeg', null);
    await ctx.prisma.attachment.create({
      data: { fileObjectId: file.id, subjectType: 'other', subjectId: 1n, role: 'e2e' },
    });
    await index();
    const staff = await staffToken(ctx, 'admin');
    const res = (
      await as(ctx, staff)
        .get(`/v1/admin/file-search?q=${encodeURIComponent('สัญญาเช่าเครื่องจักร')}`)
        .expect(200)
    ).body;
    const ids = res.data.map((h: Rec) => h.file.id);
    expect(ids).toContain(file.publicId);
    expect(res.data.find((h: Rec) => h.file.id === file.publicId)).toMatchObject({
      usages: [{ source: 'other_attachment' }],
      text: { method: 'image_ocr', ocrPages: 1 },
    });
    // The factory's documents with the same words are not in the back office.
    expect(res.data.every((h: Rec) => h.usages.every((u: Rec) => !String(u.source).startsWith('erp_')))).toBe(
      true,
    );
    // The text state, and reading it again.
    expect(
      (await as(ctx, staff).get(`/v1/admin/file-search/${file.publicId}/text`).expect(200)).body,
    ).toMatchObject({
      status: 'indexed',
      method: 'image_ocr',
    });
    const again = await as(ctx, staff)
      .post('/v1/admin/file-search/actions/reindex', { fileIds: [file.publicId] })
      .expect(200);
    expect(again.body).toEqual({ queued: 1 });
    // The search was audited as data access.
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'file_search.searched', category: 'data_access' } }),
    ).toBeGreaterThan(0);
  });
});
