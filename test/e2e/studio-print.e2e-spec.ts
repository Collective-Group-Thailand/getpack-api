import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { OBJECT_STORAGE } from '@collective/integrations/storage';
import { PreflightService } from '@modules/artwork/preflight/preflight.service';
import sharp from 'sharp';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import { type UserActor } from '../../src/common/context/actor';
import { StudioPrintService } from '../../src/modules/studio/studio-print.service';
import { StyleImportService } from '../../src/modules/styles/style-import.service';
import { FileProcessingJobs } from '../../src/platform/files/file-processing.jobs';
import {
  addAddress,
  as,
  customerToken,
  foldingBackToRfq,
  foldingConfiguration,
  foldingReady,
  postcodes,
  seedShipping,
  setFlag,
  staffToken,
} from '../support/commerce-e2e';
import { bootFulfilmentApp, type FulfilmentApp } from '../support/fulfilment-e2e';

/** A base no other suite gives a recipe: the style suites share the e2e database. */
const BASE = 'PK-CF-01';
type FakeStorage = { putDirect(key: string, body: Buffer, contentType: string): void };

/** U4.B4 print file on the server, digital proof and order hand-off (D-280, ADR-0011; fake engine). */
describe('studio print file and order hand-off (e2e, U4.B4)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let code: string;
  let token: string;
  let productId: string;
  let variantCode: string;

  async function upload(body: Buffer, mimeType: string, name: string) {
    const presigned = await as(ctx, token)
      .post('/v1/store/files/presign', {
        purpose: 'design_asset',
        fileName: name,
        mimeType,
        sizeBytes: body.length,
      })
      .expect(201);
    const row = await ctx.prisma.fileObject.findUniqueOrThrow({
      where: { publicId: presigned.body.fileId as string },
    });
    ctx.app.get<FakeStorage>(OBJECT_STORAGE).putDirect(row.storageKey, body, mimeType);
    await as(ctx, token).post(`/v1/store/files/${presigned.body.fileId}/actions/complete`, {}).expect(200);
    await ctx.app
      .get(FileProcessingJobs)
      .processOne(await ctx.prisma.fileObject.findUniqueOrThrow({ where: { id: row.id } }));
    return presigned.body.fileId as string;
  }

  /** A checked, priced studio design ready to order (its renders still missing). */
  async function readyDesign(title: string) {
    const { quantities: _q, ...spec } = foldingConfiguration(fixture, [1000]);
    void _q;
    const created = await as(ctx, token)
      .post('/v1/store/designs', {
        catalogProductId: productId,
        patternId: fixture.patternPublicId,
        title,
        schemaVersion: 2,
        document: {
          spec: {},
          content: {
            pattern: { kind: 'none' },
            elements: [
              {
                id: 'img',
                type: 'image',
                naturalWidth: 4000,
                naturalHeight: 4000,
                width: 100,
                height: 100,
                scaleX: 1,
                scaleY: 1,
              },
            ],
          },
        },
        lengthMm: spec.l,
        widthMm: spec.w,
        heightMm: spec.d,
        measurementBasis: 'product',
        materialId: fixture.materialPublicId,
        styleVariantCode: variantCode,
        printMethod: 'offset',
        printSides: 'outside',
        spec,
      })
      .expect(201);
    const id = created.body.id as string;
    const quote = await as(ctx, token)
      .post(`/v1/store/studio/${id}/quote/actions/save`, { quantities: [1000], deliveryPostcode: code })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    return { id, quoteId: quote.body.id as string, quoteOptionId: quote.body.options[0].id as string };
  }

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    [code] = postcodes(ctx, 1) as [string];
    await seedShipping(ctx, fixture.factoryPublicId, [code]);
    productId = (await ctx.prisma.catalogProduct.findUniqueOrThrow({ where: { slug: 'dev-tuck-end-box' } }))
      .publicId;
    token = (await customerToken(ctx, 91)).token;
    const admin = await ctx.prisma.user.findFirstOrThrow({ where: { email: 'admin@example.invalid' } });
    const actor: UserActor = {
      type: 'user',
      userId: admin.id,
      publicId: admin.publicId,
      audience: 'staff',
      scopes: [],
    };
    const imports = ctx.app.get(StyleImportService);
    const master = readFileSync(
      join(__dirname, '..', '..', 'docs', 'design-tool', 'style-library-master.json'),
      'utf8',
    );
    const plan = await imports.plan('master', 'style-library-master.json', master);
    if (!plan.noop) await imports.apply(actor, plan);
    const recipes = await imports.plan(
      'recipes',
      'print.json',
      JSON.stringify({
        schemaVersion: '1.0',
        recipes: [
          {
            baseCode: BASE,
            recipe: { fake: true, baseCode: BASE },
            sizeRanges: { paperboard: { minL: 20, maxL: 600, minW: 15, maxW: 400, minH: 20, maxH: 400 } },
          },
        ],
      }),
    );
    if (!recipes.noop) await imports.apply(actor, recipes);
    const prepress = await staffToken(ctx, 'prepress');
    const base = await ctx.prisma.styleBase.findUniqueOrThrow({
      where: { code: BASE },
      include: { recipes: { include: { importRun: true } }, variants: { take: 1, orderBy: { code: 'asc' } } },
    });
    for (const r of base.recipes.filter((x) => !x.approvedAt && x.importRun?.createdById === admin.id))
      await as(ctx, prepress)
        .post(`/v1/admin/styles/${base.publicId}/recipes/${r.publicId}/actions/approve`)
        .expect(200);
    variantCode = base.variants[0]!.code;
    // Publishability and the price path are covered by the style suites: here the variant is published, priced
    // instantly and its base is the folding fixture's box style, so the studio quotation prices (D-243, D-266).
    const pattern = await ctx.prisma.pattern.findUniqueOrThrow({
      where: { publicId: fixture.patternPublicId },
    });
    await ctx.prisma.styleBase.updateMany({
      where: { patternId: pattern.id, NOT: { id: base.id } },
      data: { patternId: null },
    });
    await ctx.prisma.styleBase.update({
      where: { id: base.id },
      data: { patternId: pattern.id, status: 'active', hidden: false },
    });
    await ctx.prisma.styleVariant.update({
      where: { code: variantCode },
      data: { publishable: true, reasons: [], pricePath: 'instant', priceReasons: [], status: 'active' },
    });
    await setFlag(ctx, 'drawing.engine', true);
    await addAddress(ctx, token, code);
  });

  afterAll(async () => {
    await setFlag(ctx, 'drawing.engine', false);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  const tile = () =>
    sharp({ create: { width: 200, height: 120, channels: 3, background: '#2e86c1' } })
      .jpeg()
      .toBuffer();

  it('refuses to order without renders or with a quotation of another version, then queues the print job (202)', async () => {
    const d = await readyDesign('สั่งจากสตูดิโอ (fake)');
    const order = { quoteId: d.quoteId, quoteOptionId: d.quoteOptionId };
    const missing = await as(ctx, token)
      .post(`/v1/store/studio/${d.id}/order`, order)
      .set('Idempotency-Key', randomUUID())
      .expect(409);
    expect(missing.body.code).toBe('studio.renders_missing');
    const other = await readyDesign('อีกแบบ (fake)');
    const wrong = await as(ctx, token)
      .post(`/v1/store/studio/${d.id}/order`, { quoteId: other.quoteId, quoteOptionId: other.quoteOptionId })
      .set('Idempotency-Key', randomUUID())
      .expect(422);
    expect(wrong.body.code).toBe('studio.quote_not_of_version');

    const jpeg = await upload(await tile(), 'image/jpeg', 'tile.jpg');
    const png = await upload(
      await sharp({ create: { width: 50, height: 50, channels: 4, background: '#000000ff' } })
        .png()
        .toBuffer(),
      'image/png',
      'foil.png',
    );
    await as(ctx, token)
      .post(`/v1/store/studio/${d.id}/versions/1/renders`, {
        side: 'outside',
        kind: 'tile',
        xMm: 0,
        yMm: 0,
        widthMm: 300,
        heightMm: 180,
        fileId: png,
      })
      .expect(422);
    await as(ctx, token)
      .post(`/v1/store/studio/${d.id}/versions/1/renders`, {
        side: 'outside',
        kind: 'tile',
        xMm: 0,
        yMm: 0,
        widthMm: 300,
        heightMm: 180,
        fileId: jpeg,
      })
      .expect(201);
    const renders = await as(ctx, token)
      .post(`/v1/store/studio/${d.id}/versions/1/renders`, {
        side: 'outside',
        kind: 'finish_mask',
        separation: 'Foil',
        xMm: 20,
        yMm: 20,
        widthMm: 40,
        heightMm: 40,
        fileId: png,
      })
      .expect(201);
    expect(renders.body).toHaveLength(2);

    const queued = await as(ctx, token)
      .post(`/v1/store/studio/${d.id}/order`, order)
      .set('Idempotency-Key', randomUUID())
      .expect(202);
    expect(queued.body).toMatchObject({
      status: 'queued',
      versionNo: 1,
      orderId: null,
      statusUrl: expect.stringContaining(queued.body.id),
    });
    const cart = await as(ctx, token).get('/v1/store/cart').expect(200);
    const items = cart.body.items as { id: string; designVersionNo: number }[];
    expect(items.find((i) => i.id === queued.body.cartItemId)).toMatchObject({
      designVersionNo: 1,
    });

    // The worker assembles the print file, the snapshot and the digital proof.
    await ctx.app.get(StudioPrintService).runDue();
    const done = await as(ctx, token).get(`/v1/store/studio/jobs/${queued.body.id}`).expect(200);
    expect(done.body).toMatchObject({ status: 'succeeded', error: null });
    expect(done.body.printFileUrl).toMatch(/^https?:\/\//);
    expect(done.body.proofFileUrl).toMatch(/^https?:\/\//);
    const job = await ctx.prisma.studioPrintJob.findUniqueOrThrow({
      where: { publicId: queued.body.id as string },
      include: { printFile: true, proofFile: true },
    });
    // Outside page + one separation page for the foil; the proof adds its cover.
    const { PDFDocument } = await import('pdf-lib');
    const pages = async (key: string) => {
      const chunks: Buffer[] = [];
      for await (const c of await ctx.app
        .get<{ getStream(k: string): Promise<AsyncIterable<Buffer>> }>(OBJECT_STORAGE)
        .getStream(key))
        chunks.push(c);
      return (await PDFDocument.load(Buffer.concat(chunks))).getPageCount();
    };
    expect(await pages(job.printFile!.storageKey)).toBe(2);
    expect(await pages(job.proofFile!.storageKey)).toBe(3);

    // Checkout: the order takes the finished job as its artwork, preflight runs and is kept as the pdf check run.
    const placed = await as(ctx, token)
      .post('/v1/store/checkout', {})
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const orderId = (placed.body.orders as { id: string }[]).at(-1)!.id;
    const attached = await ctx.prisma.studioPrintJob.findUniqueOrThrow({
      where: { id: job.id },
      include: { order: true, submission: { include: { files: true } } },
    });
    expect(attached.order?.publicId).toBe(orderId);
    expect(attached.submission?.files.map((f) => f.role).sort()).toEqual([
      'artwork',
      'reference',
      'reference',
    ]);
    expect(attached.submission?.designDocumentVersionId).toBe(job.versionId);
    await ctx.app.get(PreflightService).runDue();
    await ctx.pump();
    const pdfRun = await ctx.prisma.designCheckRun.findFirst({
      where: { versionId: job.versionId, source: 'pdf' },
    });
    expect(pdfRun).not.toBeNull();
  });

  it('attaches a print file finished after the order was placed', async () => {
    const d = await readyDesign('สั่งก่อนไฟล์เสร็จ (fake)');
    const jpeg = await upload(await tile(), 'image/jpeg', 'tile2.jpg');
    await as(ctx, token)
      .post(`/v1/store/studio/${d.id}/versions/1/renders`, {
        side: 'outside',
        kind: 'tile',
        xMm: 0,
        yMm: 0,
        widthMm: 300,
        heightMm: 180,
        fileId: jpeg,
      })
      .expect(201);
    const queued = await as(ctx, token)
      .post(`/v1/store/studio/${d.id}/order`, { quoteId: d.quoteId, quoteOptionId: d.quoteOptionId })
      .set('Idempotency-Key', randomUUID())
      .expect(202);
    const placed = await as(ctx, token)
      .post('/v1/store/checkout', {})
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const before = await ctx.prisma.studioPrintJob.findUniqueOrThrow({
      where: { publicId: queued.body.id as string },
    });
    expect(before.orderId).not.toBeNull();
    expect(before.submissionId).toBeNull();
    await ctx.app.get(StudioPrintService).runDue();
    const after = await as(ctx, token).get(`/v1/store/studio/jobs/${queued.body.id}`).expect(200);
    expect(after.body).toMatchObject({
      status: 'succeeded',
      orderId: (placed.body.orders as { id: string }[]).at(-1)!.id,
    });
    expect(after.body.submissionId).not.toBeNull();
    // Not a company order: no approval view.
    await as(ctx, token).get(`/v1/store/studio/approvals/${after.body.orderId}`).expect(404);
    const other = (await customerToken(ctx, 92)).token;
    await as(ctx, other).get(`/v1/store/studio/jobs/${queued.body.id}`).expect(404);
  });
});
