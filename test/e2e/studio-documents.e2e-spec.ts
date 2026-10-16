import { randomUUID } from 'node:crypto';

import { OBJECT_STORAGE } from '@integrations/s3/object-storage.port';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  addAddress,
  as,
  customerToken,
  foldingBackToRfq,
  foldingReady,
  postcodes,
  saveQuote,
  seedShipping,
} from '../support/commerce-e2e';
import { bootFulfilmentApp, type FulfilmentApp } from '../support/fulfilment-e2e';

const DOC = { version: 1, faces: { front: { objects: [{ type: 'text', text: 'getpack' }] } } };

type FakeStorage = { putPart(uploadId: string, partNumber: number, body: Buffer): string };

/** U4.B1 studio documents (D-275, D-276): the box and spec per version, JSON-Patch autosave, version pin and lock. */
describe('studio documents (e2e, U4.B1)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let code: string;
  let productId: string;
  let token: string;
  let designId: string;
  let etag: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    [code] = postcodes(ctx, 1) as [string];
    await seedShipping(ctx, fixture.factoryPublicId, [code]);
    productId = (await ctx.prisma.catalogProduct.findUniqueOrThrow({ where: { slug: 'dev-tuck-end-box' } }))
      .publicId;
    token = (await customerToken(ctx, 61)).token;
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  it('keeps the studio box and the spec on every version', async () => {
    const spec = {
      patternId: fixture.patternPublicId,
      materialId: fixture.materialPublicId,
      w: 60,
      l: 100,
      d: 40,
    };
    const bad = await as(ctx, token)
      .post('/v1/store/designs', {
        catalogProductId: productId,
        title: 'สตูดิโอ (fake)',
        document: DOC,
        finishes: ['no-such-finish'],
      })
      .expect(422);
    expect(bad.body.errors[0].path).toBe('finishes');
    const created = await as(ctx, token)
      .post('/v1/store/designs', {
        catalogProductId: productId,
        patternId: fixture.patternPublicId,
        title: 'สตูดิโอ (fake)',
        schemaVersion: 1,
        document: DOC,
        lengthMm: 100,
        widthMm: 60,
        heightMm: 40,
        measurementBasis: 'internal',
        printMethod: 'digital',
        printSides: 'outside',
        finishes: ['dev-matt'],
        spec,
      })
      .expect(201);
    designId = created.body.id as string;
    etag = created.headers['etag'] as string;
    expect(created.body).toMatchObject({
      printMethod: 'digital',
      printSides: 'outside',
      finishes: ['dev-matt'],
      spec,
      lock: null,
      versionNo: 1,
    });
    const v1 = await as(ctx, token).get(`/v1/store/designs/${designId}/versions/1`).expect(200);
    expect(v1.body.box).toMatchObject({ printMethod: 'digital', lengthMm: 100, finishes: ['dev-matt'] });
    expect(v1.body.spec).toEqual(spec);
  });

  it('autosaves JSON Patches under If-Match, all or nothing, carrying the spec forward', async () => {
    const path = `/v1/store/designs/${designId}/document`;
    const ops = { operations: [{ op: 'replace', path: '/faces/front/objects/0/text', value: 'กาแฟ' }] };
    await as(ctx, token).patch(path).send(ops).expect(428);
    const patched = await as(ctx, token).patch(path).set('If-Match', etag).send(ops).expect(200);
    expect(patched.body).toMatchObject({
      versionNo: 2,
      document: { faces: { front: { objects: [{ text: 'กาแฟ' }] } } },
    });
    expect(patched.body.spec).not.toBeNull();
    // The old ETag is stale now.
    const stale = await as(ctx, token).patch(path).set('If-Match', etag).send(ops).expect(412);
    expect(stale.body.code).toBe('concurrency.stale');
    etag = patched.headers['etag'] as string;
    const failed = await as(ctx, token)
      .patch(path)
      .set('If-Match', etag)
      .send({
        operations: [
          { op: 'add', path: '/faces/back', value: {} },
          { op: 'test', path: '/version', value: 99 },
        ],
      })
      .expect(422);
    expect(failed.body).toMatchObject({ code: 'designs.patch_failed', errors: [{ path: 'operations[1]' }] });
    const versions = await as(ctx, token).get(`/v1/store/designs/${designId}/versions`).expect(200);
    expect((versions.body as { kind: string }[])[0]).toMatchObject({ versionNo: 2, kind: 'autosave' });
  });

  it('takes a document above 1 MB on design routes (finding U1)', async () => {
    const big = { ...DOC, blob: 'x'.repeat(1_400_000) };
    const saved = await as(ctx, token)
      .put(`/v1/store/designs/${designId}`)
      .set('If-Match', etag)
      .send({ schemaVersion: 1, document: big, kind: 'manual' })
      .expect(200);
    expect(saved.body.versionNo).toBe(3);
    etag = saved.headers['etag'] as string;
    // Other routes keep the 1 MB limit.
    await as(ctx, token)
      .post('/v1/store/cart/items')
      .send({ blob: 'x'.repeat(1_100_000) })
      .expect(413);
    // Back to a small document for the rest of the suite.
    const small = await as(ctx, token)
      .put(`/v1/store/designs/${designId}`)
      .set('If-Match', etag)
      .send({ schemaVersion: 1, document: DOC })
      .expect(200);
    etag = small.headers['etag'] as string;
  });

  it('pins the version at add-to-cart and locks it on order; edits make new versions (D-276)', async () => {
    const address = await addAddress(ctx, token, code);
    const quote = await saveQuote(ctx, token, fixture, [1000]);
    const cart = await as(ctx, token)
      .post('/v1/store/cart/items', {
        quoteId: quote.id,
        quoteOptionId: quote.options[0]!.id,
        destinations: [{ addressId: address.id, quantity: 1000 }],
        designOption: 'online_designer',
        designDocumentId: designId,
        designVersionNo: 2,
      })
      .expect(201);
    expect(cart.body.items[0]).toMatchObject({ designDocumentId: designId, designVersionNo: 2 });
    // Editing after add-to-cart leaves the pinned version alone.
    await as(ctx, token)
      .patch(`/v1/store/designs/${designId}/document`)
      .set('If-Match', etag)
      .send({ operations: [{ op: 'add', path: '/note', value: 'after cart' }] })
      .expect(200);
    const placed = await as(ctx, token)
      .post('/v1/store/checkout', {})
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const orderId = placed.body.orders[0].id as string;
    const order = await ctx.prisma.order.findUniqueOrThrow({
      where: { publicId: orderId },
      include: { designDocumentVersion: true },
    });
    expect(order.designDocumentVersion?.versionNo).toBe(2);
    const design = await as(ctx, token).get(`/v1/store/designs/${designId}`).expect(200);
    expect(design.body).toMatchObject({ versionNo: 5, lock: { versionNo: 2, orderId } });
    // The order's version is write-once (A-95 trigger).
    const v1 = await ctx.prisma.designDocumentVersion.findFirstOrThrow({
      where: { designDocument: { publicId: designId }, versionNo: 1 },
    });
    await expect(
      ctx.prisma.order.update({ where: { id: order.id }, data: { designDocumentVersionId: v1.id } }),
    ).rejects.toThrow();
    // The artwork submitted from the design is the ordered version, not the newest.
    const submitted = await as(ctx, token)
      .post(`/v1/store/orders/${orderId}/artwork-submissions/from-design`, {})
      .expect(201);
    const row = await ctx.prisma.artworkSubmission.findUniqueOrThrow({
      where: { publicId: submitted.body.id as string },
    });
    expect(row.designDocumentVersionId).toBe(order.designDocumentVersionId);
  });

  it('refuses a design without a saved version in the cart', async () => {
    const empty = await as(ctx, token)
      .post('/v1/store/designs', { catalogProductId: productId, title: 'ว่าง (fake)' })
      .expect(201);
    const address = await addAddress(ctx, token, code);
    const quote = await saveQuote(ctx, token, fixture, [1000]);
    const res = await as(ctx, token)
      .post('/v1/store/cart/items', {
        quoteId: quote.id,
        quoteOptionId: quote.options[0]!.id,
        destinations: [{ addressId: address.id, quantity: 1000 }],
        designOption: 'online_designer',
        designDocumentId: empty.body.id,
      })
      .expect(422);
    expect(res.body.code).toBe('designs.version_required');
  });

  it('resumes a large multipart upload with the stored parts and fresh URLs', async () => {
    const size = 150 * 1024 * 1024;
    const presigned = await as(ctx, token)
      .post('/v1/store/files/presign', {
        purpose: 'artwork',
        fileName: 'big.pdf',
        mimeType: 'application/pdf',
        sizeBytes: size,
      })
      .expect(201);
    const { uploadId, partSize, parts } = presigned.body.multipart as {
      uploadId: string;
      partSize: number;
      parts: { partNumber: number }[];
    };
    ctx.app.get<FakeStorage>(OBJECT_STORAGE).putPart(uploadId, 1, Buffer.alloc(8));
    const resumed = await as(ctx, token)
      .post(`/v1/store/files/${presigned.body.fileId}/actions/resume`)
      .expect(200);
    expect(resumed.body).toMatchObject({ partSize, uploaded: [{ partNumber: 1, etag: '"etag-1"' }] });
    expect(resumed.body.parts).toHaveLength(parts.length);
    const other = (await customerToken(ctx, 62)).token;
    await as(ctx, other).post(`/v1/store/files/${presigned.body.fileId}/actions/resume`).expect(404);
  });
});
