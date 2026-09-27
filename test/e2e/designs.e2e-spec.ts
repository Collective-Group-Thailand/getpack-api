import { randomUUID } from 'node:crypto';

import { PreflightService } from '@modules/artwork/preflight/preflight.service';
import { DrawingsService } from '@modules/designs/drawings.service';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  addAddress,
  as,
  customerToken,
  foldingBackToRfq,
  foldingReady,
  placeOrder,
  postcodes,
  saveQuote,
  seedShipping,
  setFlag,
  staffToken,
  uploadFile,
} from '../support/commerce-e2e';
import { bootFulfilmentApp, type FulfilmentApp, makePdf, payDue, uploadPdf } from '../support/fulfilment-e2e';

const DOC = { pages: [{ side: 'front', objects: [{ type: 'text', text: 'Packio', x: 10, y: 20 }] }] };

/**
 * Online designs and dieline drawings (B4.1): versions with ETag, assets, semi-design templates, the online
 * design placed with the order and submitted as its artwork; drawings answer 501 while `drawing.engine` is
 * off, otherwise they are drawn by the worker; after payment an own-file order gets its template
 * automatically (legacy sendDrawingAutov2) and the preflight checks against it.
 */
describe('designs and drawings (e2e, B4.1)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let code: string;
  let productId: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    [code] = postcodes(ctx, 1) as [string];
    await seedShipping(ctx, fixture.factoryPublicId, [code]);
    await setFlag(ctx, 'payments.scb', true);
    productId = (await ctx.prisma.catalogProduct.findUniqueOrThrow({ where: { slug: 'dev-tuck-end-box' } }))
      .publicId;
    // The folding fixture's box style gets an (obviously fake) dieline key so it can be drawn.
    await ctx.prisma.pattern.update({
      where: { publicId: fixture.patternPublicId },
      data: { dielineKey: 'dev_fake_rte' },
    });
  });

  afterAll(async () => {
    await setFlag(ctx, 'drawing.engine', false);
    await setFlag(ctx, 'payments.scb', false);
    await ctx?.prisma.pattern.update({
      where: { publicId: fixture.patternPublicId },
      data: { dielineKey: null },
    });
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  it('saves immutable versions under ETag, with assets, and starts designs from templates', async () => {
    const { token } = await customerToken(ctx, 1);
    const other = await customerToken(ctx, 2);
    const created = await as(ctx, token)
      .post('/v1/store/designs', {
        catalogProductId: productId,
        patternId: fixture.patternPublicId,
        lengthMm: 300,
        widthMm: 200,
        heightMm: 50,
        title: 'กล่องของฉัน',
        schemaVersion: 1,
        document: DOC,
      })
      .expect(201);
    expect(created.body).toMatchObject({ versionNo: 1, schemaVersion: 1, document: DOC });
    const id = created.body.id as string;
    const etag = created.headers['etag'] as string;

    await as(ctx, token)
      .put(`/v1/store/designs/${id}`, { schemaVersion: 1, document: { pages: [] } })
      .expect(428);
    const saved = await as(ctx, token)
      .put(`/v1/store/designs/${id}`, { title: 'กล่องของฉัน v2', schemaVersion: 1, document: { pages: [] } })
      .set('If-Match', etag)
      .expect(200);
    expect(saved.body).toMatchObject({ versionNo: 2, title: 'กล่องของฉัน v2', document: { pages: [] } });
    await as(ctx, token)
      .put(`/v1/store/designs/${id}`, { schemaVersion: 1, document: DOC })
      .set('If-Match', etag)
      .expect(412);
    const versions = await as(ctx, token).get(`/v1/store/designs/${id}/versions`).expect(200);
    expect((versions.body as { versionNo: number }[]).map((v) => v.versionNo)).toEqual([2, 1]);
    expect(
      (await as(ctx, token).get(`/v1/store/designs/${id}/versions/1`).expect(200)).body.document,
    ).toEqual(DOC);
    await as(ctx, other.token).get(`/v1/store/designs/${id}`).expect(404);

    const logo = await uploadFile(ctx, token, 'logo', 'evidence');
    const withAsset = await as(ctx, token)
      .post(`/v1/store/designs/${id}/assets`, { fileId: logo, kind: 'logo' })
      .expect(201);
    expect(withAsset.body.assets).toHaveLength(1);
    await as(ctx, token)
      .delete(`/v1/store/designs/${id}/assets/${withAsset.body.assets[0].id as string}`)
      .expect(200);

    // Staff author a template design and link it to a semi-design template; a customer starts from it.
    const admin = await staffToken(ctx, 'admin');
    const templateDesign = await as(ctx, admin)
      .post('/v1/admin/designs', {
        catalogProductId: productId,
        title: 'เทมเพลตกาแฟ',
        schemaVersion: 1,
        document: DOC,
      })
      .expect(201);
    const product = await ctx.prisma.catalogProduct.findUniqueOrThrow({
      where: { slug: 'dev-tuck-end-box' },
      include: { standardSizes: true },
    });
    const thumb = await ctx.prisma.fileObject.findUniqueOrThrow({ where: { publicId: logo } });
    const semi = await ctx.prisma.semiDesign.create({
      data: { catalogProductId: product.id, name: '[DEV] กาแฟ', status: 'active' },
    });
    const template = await ctx.prisma.semiDesignTemplate.create({
      data: {
        semiDesignId: semi.id,
        standardSizeId: product.standardSizes[0]!.id,
        thumbnailFileId: thumb.id,
        status: 'active',
      },
    });
    await as(ctx, token)
      .post('/v1/store/designs', {
        catalogProductId: productId,
        semiDesignTemplateId: template.publicId,
        title: 'จากเทมเพลต',
      })
      .expect(409);
    await as(ctx, admin)
      .post(`/v1/admin/catalog/semi-design-templates/${template.publicId}/actions/set-design`, {
        designId: templateDesign.body.id,
      })
      .expect(204);
    const fromTemplate = await as(ctx, token)
      .post('/v1/store/designs', {
        catalogProductId: productId,
        semiDesignTemplateId: template.publicId,
        title: 'จากเทมเพลต',
      })
      .expect(201);
    expect(fromTemplate.body).toMatchObject({
      versionNo: 1,
      document: DOC,
      semiDesignTemplateId: template.publicId,
    });

    await as(ctx, token).delete(`/v1/store/designs/${id}`).expect(204);
    await as(ctx, token).get(`/v1/store/designs/${id}`).expect(404);
  });

  it('places an online design with the order and submits it as the artwork', async () => {
    const { token } = await customerToken(ctx, 3);
    const design = await as(ctx, token)
      .post('/v1/store/designs', {
        catalogProductId: productId,
        title: 'ออกแบบออนไลน์',
        schemaVersion: 1,
        document: DOC,
      })
      .expect(201);
    const address = await addAddress(ctx, token, code);
    const quote = await saveQuote(ctx, token, fixture, [1000]);
    const item = {
      quoteId: quote.id,
      quoteOptionId: quote.options[0]!.id,
      destinations: [{ addressId: address.id, quantity: 1000 }],
    };
    await as(ctx, token)
      .post('/v1/store/cart/items', { ...item, designOption: 'own_file', designDocumentId: design.body.id })
      .expect(422);
    const cart = await as(ctx, token)
      .post('/v1/store/cart/items', {
        ...item,
        designOption: 'online_designer',
        designDocumentId: design.body.id,
      })
      .expect(201);
    expect(cart.body.items[0].designDocumentId).toBe(design.body.id);
    const placed = await as(ctx, token)
      .post('/v1/store/checkout', {})
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const orderId = placed.body.orders[0].id as string;
    const submitted = await as(ctx, token)
      .post(`/v1/store/orders/${orderId}/artwork-submissions/from-design`, {})
      .expect(201);
    expect(submitted.body).toMatchObject({ source: 'designer', files: [], versionNo: 1 });
    const row = await ctx.prisma.artworkSubmission.findUniqueOrThrow({
      where: { publicId: submitted.body.id as string },
    });
    const version = await ctx.prisma.designDocumentVersion.findFirstOrThrow({
      where: { designDocument: { publicId: design.body.id as string } },
    });
    expect(row.designDocumentVersionId).toBe(version.id);
  });

  it('answers 501 while the engine is off, draws once it is on, and sends the template after payment', async () => {
    const { token } = await customerToken(ctx, 4);
    const prepress = await staffToken(ctx, 'prepress');
    const drawing = {
      patternId: fixture.patternPublicId,
      lengthMm: 300,
      widthMm: 200,
      heightMm: 50,
      format: 'pdf',
    };
    const off = await as(ctx, token).post('/v1/store/drawings', drawing).expect(501);
    expect(off.body.code).toBe('drawing.engine_unavailable');
    // The refused attempt stays in the drawing log.
    expect(
      await ctx.prisma.drawingJob.count({
        where: {
          status: 'engine_unavailable',
          patternId: (
            await ctx.prisma.pattern.findUniqueOrThrow({ where: { publicId: fixture.patternPublicId } })
          ).id,
        },
      }),
    ).toBeGreaterThan(0);

    // Paid while off: Prepress is told to send the template by hand.
    const offGroup = await placeOrder(ctx, token, fixture, code);
    await payDue(ctx, token, offGroup.id);
    await ctx.pump();
    const offOrder = offGroup.orders[0]!.id;
    expect(
      await ctx.prisma.activityLog.count({
        where: { aggregatePublicId: offOrder, action: 'dieline.auto_unavailable' },
      }),
    ).toBe(1);
    await as(ctx, prepress).post(`/v1/admin/orders/${offOrder}/drawings`, {}).expect(501);

    await setFlag(ctx, 'drawing.engine', true);
    const queued = await as(ctx, token).post('/v1/store/drawings', drawing).expect(202);
    expect(queued.body.status).toBe('queued');
    await ctx.app.get(DrawingsService).runDue();
    const drawn = await as(ctx, token)
      .get(`/v1/store/drawings/${queued.body.id as string}`)
      .expect(200);
    expect(drawn.body.status).toBe('succeeded');
    await as(ctx, token)
      .get(`/v1/store/files/${drawn.body.outputFileId as string}/download`)
      .expect(200);

    // Paid while on: the template is drawn and sent; the customer's artwork is checked against it.
    const group = await placeOrder(ctx, token, fixture, code);
    const orderId = group.orders[0]!.id;
    await payDue(ctx, token, group.id);
    await ctx.pump();
    await ctx.app.get(DrawingsService).runDue();
    const templates = await as(ctx, token).get(`/v1/store/orders/${orderId}/templates`).expect(200);
    expect(templates.body).toMatchObject([{ trigger: 'auto_after_payment' }]);
    expect((await as(ctx, token).get(`/v1/store/orders/${orderId}`).expect(200)).body.artworkStatus).toBe(
      'awaiting_upload',
    );
    // The fake engine draws a (2L + 2W) × (H + W) blank: 1000 × 250 mm.
    const artwork = await uploadPdf(ctx, token, await makePdf({ widthMm: 1006, heightMm: 256, bleedMm: 3 }));
    const submission = await as(ctx, token)
      .post(`/v1/store/orders/${orderId}/artwork-submissions`, { files: [{ fileId: artwork }] })
      .expect(201);
    await ctx.app.get(PreflightService).runDue();
    const checked = await as(ctx, token)
      .get(`/v1/store/orders/${orderId}/artwork-submissions/${submission.body.id as string}`)
      .expect(200);
    expect(checked.body).toMatchObject({
      preflightStatus: 'passed',
      preflightReport: { expectedSize: { widthMm: 1000, heightMm: 250 } },
    });
    // Staff draw again for the order: a manual template follows.
    const manual = await as(ctx, prepress).post(`/v1/admin/orders/${orderId}/drawings`, {}).expect(202);
    await ctx.app.get(DrawingsService).runDue();
    expect(
      (await as(ctx, prepress).get(`/v1/admin/orders/${orderId}/templates`).expect(200)).body,
    ).toHaveLength(2);
    expect(manual.body.orderId).toBe(orderId);
  });
});
