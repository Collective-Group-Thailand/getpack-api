import request from 'supertest';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  as,
  bootCommerceApp,
  type CommerceApp,
  customerToken,
  foldingBackToRfq,
  foldingReady,
  placeOrder,
  postcodes,
  seedShipping,
  staffToken,
  uploadFile,
} from '../support/commerce-e2e';

const DOC = { pages: [{ side: 'front', objects: [{ type: 'text', text: 'getpack', x: 10, y: 20 }] }] };
const DOC2 = { pages: [{ side: 'front', objects: [] }] };
const DAY_MS = 86_400_000;

/**
 * U-B0.1 slice 9b: the store designs gaps — list enrichment and the `linked` filter, save kind / label, version
 * paging, restore, duplicate, guest import, `design_asset` uploads with signed URLs, the view-only share link
 * (D-226) and the designer catalogue.
 */
describe('store designs (e2e, U-B0.1)', () => {
  let ctx: CommerceApp;
  let fixture: DevFolding;
  let postcode: string;
  let productId: string;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    fixture = await foldingReady(ctx);
    postcode = postcodes(ctx, 1)[0]!;
    await seedShipping(ctx, fixture.factoryPublicId, [postcode]);
    productId = (await ctx.prisma.catalogProduct.findUniqueOrThrow({ where: { slug: 'dev-tuck-end-box' } }))
      .publicId;
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  const create = (token: string, title: string, document: object = DOC) =>
    as(ctx, token)
      .post('/v1/store/designs', {
        catalogProductId: productId,
        patternId: fixture.patternPublicId,
        title,
        schemaVersion: 1,
        document,
      })
      .expect(201);

  it('keeps autosaves apart, pages the history and restores an earlier version as a new one', async () => {
    const { token } = await customerToken(ctx, 1);
    const api = as(ctx, token);
    const created = await create(token, 'ประวัติ');
    const id = created.body.id as string;
    expect(created.body).toMatchObject({
      product: { id: productId, slug: 'dev-tuck-end-box' },
      orders: [],
      share: null,
      thumbnailUrl: null,
    });
    const auto = await api
      .put(`/v1/store/designs/${id}`, { schemaVersion: 1, document: DOC2, kind: 'autosave' })
      .set('If-Match', created.headers['etag'] as string)
      .expect(200);
    const manual = await api
      .put(`/v1/store/designs/${id}`, {
        schemaVersion: 1,
        document: DOC2,
        label: 'ก่อนเปลี่ยนสี',
        heightMm: 55,
      })
      .set('If-Match', auto.headers['etag'] as string)
      .expect(200);
    expect(manual.body).toMatchObject({ versionNo: 3, heightMm: 55 });

    const all = (await api.get(`/v1/store/designs/${id}/versions`).expect(200)).body as {
      versionNo: number;
      kind: string;
      label: string | null;
    }[];
    expect(all.map((v) => [v.versionNo, v.kind, v.label])).toEqual([
      [3, 'manual', 'ก่อนเปลี่ยนสี'],
      [2, 'autosave', null],
      [1, 'manual', null],
    ]);
    const manualOnly = (await api.get(`/v1/store/designs/${id}/versions?kind=manual`).expect(200)).body;
    expect((manualOnly as { versionNo: number }[]).map((v) => v.versionNo)).toEqual([3, 1]);
    const page1 = (await api.get(`/v1/store/designs/${id}/versions?limit=2`).expect(200)).body;
    expect((page1 as { versionNo: number }[]).map((v) => v.versionNo)).toEqual([3, 2]);
    const page2 = (await api.get(`/v1/store/designs/${id}/versions?limit=2&before=2`).expect(200)).body;
    expect((page2 as { versionNo: number }[]).map((v) => v.versionNo)).toEqual([1]);
    await api.get(`/v1/store/designs/${id}/versions?limit=0`).expect(422);

    await api.post(`/v1/store/designs/${id}/versions/1/actions/restore`).expect(428);
    await api
      .post(`/v1/store/designs/${id}/versions/1/actions/restore`)
      .set('If-Match', created.headers['etag'] as string)
      .expect(412);
    await api
      .post(`/v1/store/designs/${id}/versions/9/actions/restore`)
      .set('If-Match', manual.headers['etag'] as string)
      .expect(404);
    const restored = await api
      .post(`/v1/store/designs/${id}/versions/1/actions/restore`)
      .set('If-Match', manual.headers['etag'] as string)
      .expect(200);
    expect(restored.body).toMatchObject({ versionNo: 4, document: DOC });
    expect(restored.headers['etag']).not.toBe(manual.headers['etag']);
    const v4 = (await api.get(`/v1/store/designs/${id}/versions/4`).expect(200)).body;
    expect(v4).toMatchObject({ kind: 'restore', document: DOC });
    // History is never rewritten.
    expect((await api.get(`/v1/store/designs/${id}/versions/3`).expect(200)).body.document).toEqual(DOC2);
  });

  it('adds design_asset uploads with signed URLs and duplicates a design with its assets', async () => {
    const { token } = await customerToken(ctx, 2);
    const other = await customerToken(ctx, 3);
    const api = as(ctx, token);
    const design = await create(token, 'ต้นฉบับ');
    const id = design.body.id as string;
    const fileId = await uploadFile(ctx, token, 'fake-logo', 'design_asset');
    const withAsset = await api.post(`/v1/store/designs/${id}/assets`, { fileId, kind: 'logo' }).expect(201);
    expect(withAsset.body.assets[0]).toMatchObject({
      fileId,
      kind: 'logo',
      mimeType: 'image/png',
      sizeBytes: 'fake-logo'.length,
      url: expect.any(String),
      urlExpiresAt: expect.any(String),
    });

    await as(ctx, other.token)
      .post(`/v1/store/designs/${id}/actions/duplicate`, { title: 'ไม่ใช่ของฉัน' })
      .expect(404);
    await api.post(`/v1/store/designs/${id}/actions/duplicate`, {}).expect(422);
    const copy = await api.post(`/v1/store/designs/${id}/actions/duplicate`, { title: 'สำเนา' }).expect(201);
    expect(copy.headers['etag']).toBeDefined();
    expect(copy.body).toMatchObject({
      title: 'สำเนา',
      versionNo: 1,
      document: DOC,
      patternId: fixture.patternPublicId,
      orders: [],
      share: null,
    });
    expect(copy.body.id).not.toBe(id);
    expect((copy.body.assets as { fileId: string }[]).map((a) => a.fileId)).toEqual([fileId]);
    expect(
      await ctx.prisma.domainEvent.count({ where: { type: 'design.duplicated', aggregateId: copy.body.id } }),
    ).toBe(1);
  });

  it('lists the orders a design was used by and filters linked and unlinked designs', async () => {
    const { token } = await customerToken(ctx, 4);
    const api = as(ctx, token);
    const used = await create(token, 'ใช้แล้ว');
    const unused = await create(token, 'ยังไม่ใช้');
    const placed = await placeOrder(ctx, token, fixture, postcode);
    const order = placed.orders[0]!;
    await ctx.prisma.order.update({
      where: { publicId: order.id },
      data: { designDocument: { connect: { publicId: used.body.id as string } } },
    });

    const all = (await api.get('/v1/store/designs').expect(200)).body.data as {
      id: string;
      orders: object[];
    }[];
    expect(all.find((d) => d.id === used.body.id)?.orders).toEqual([
      { orderId: order.id, orderCode: order.orderCode },
    ]);
    const linked = (await api.get('/v1/store/designs?linked=linked').expect(200)).body.data as {
      id: string;
    }[];
    expect(linked.map((d) => d.id)).toEqual([used.body.id]);
    const unlinked = (await api.get('/v1/store/designs?linked=unlinked').expect(200)).body.data as {
      id: string;
    }[];
    expect(unlinked.map((d) => d.id)).toEqual([unused.body.id]);
    await api.get('/v1/store/designs?linked=maybe').expect(422);
  });

  it('imports guest designs once per local id and skips rows it cannot keep', async () => {
    const { token } = await customerToken(ctx, 5);
    const api = as(ctx, token);
    const row = (localId: string, extra: object = {}) => ({
      localId,
      title: `นำเข้า ${localId}`,
      catalogProductId: productId,
      schemaVersion: 1,
      document: DOC,
      ...extra,
    });
    const first = await api
      .post('/v1/store/designs/actions/import', {
        designs: [row('guest-a'), row('guest-b', { catalogProductId: undefined }), row('guest-c')],
      })
      .expect(200);
    expect(first.body.skipped).toEqual([{ localId: 'guest-b', reason: 'product_not_found' }]);
    expect((first.body.imported as { localId: string }[]).map((r) => r.localId)).toEqual([
      'guest-a',
      'guest-c',
    ]);
    const a = (first.body.imported as { localId: string; designId: string }[])[0]!.designId;
    const c = (first.body.imported as { localId: string; designId: string }[])[1]!.designId;
    const version = (await api.get(`/v1/store/designs/${a}/versions/1`).expect(200)).body;
    expect(version).toMatchObject({ kind: 'import', document: DOC });

    await api.delete(`/v1/store/designs/${c}`).expect(204);
    const replay = await api
      .post('/v1/store/designs/actions/import', { designs: [row('guest-a'), row('guest-c')] })
      .expect(200);
    expect(replay.body).toEqual({
      imported: [{ localId: 'guest-a', designId: a }],
      skipped: [{ localId: 'guest-c', reason: 'deleted' }],
    });
    expect(await ctx.prisma.designDocument.count({ where: { importLocalId: 'guest-a' } })).toBe(1);
    await api.post('/v1/store/designs/actions/import', { designs: [] }).expect(422);
    await api.post('/v1/store/designs/actions/import', { designs: [row('bad id!')] }).expect(422);
  });

  it('shares a design view-only, replaces the link on sharing again and revokes it (D-226)', async () => {
    const { token } = await customerToken(ctx, 6);
    const other = await customerToken(ctx, 7);
    const api = as(ctx, token);
    const design = await create(token, 'แชร์');
    const id = design.body.id as string;
    await as(ctx, other.token).post(`/v1/store/designs/${id}/actions/share`).expect(404);
    await api.delete(`/v1/store/designs/${id}/share`).expect(404);

    const first = await api.post(`/v1/store/designs/${id}/actions/share`).expect(201);
    expect(Date.parse(first.body.expiresAt) - Date.parse(first.body.sharedAt)).toBe(15 * DAY_MS);
    const open = (token_: string) => request(ctx.server).get(`/v1/store/shared-designs/${token_}`);
    const seen = await open(first.body.shareToken as string).expect(200);
    expect(seen.body).toMatchObject({
      title: 'แชร์',
      document: DOC,
      versionNo: 1,
      product: { id: productId },
    });
    expect(seen.body).not.toHaveProperty('id');
    expect(JSON.stringify(seen.body)).not.toContain(id);
    const row = await ctx.prisma.designDocument.findUniqueOrThrow({ where: { publicId: id } });
    expect(Buffer.from(row.shareTokenHash!).toString('base64url')).not.toBe(first.body.shareToken);

    // Sharing does not change the editor's ETag.
    const mine = await api.get(`/v1/store/designs/${id}`).expect(200);
    expect(mine.headers['etag']).toBe(design.headers['etag']);
    expect(mine.body.share).toEqual({ sharedAt: first.body.sharedAt, expiresAt: first.body.expiresAt });

    const second = await api.post(`/v1/store/designs/${id}/actions/share`).expect(201);
    await open(first.body.shareToken as string).expect(404);
    await open(second.body.shareToken as string).expect(200);

    await ctx.prisma.designDocument.update({
      where: { id: row.id },
      data: { sharedAt: new Date(Date.now() - 20 * DAY_MS), shareExpiresAt: new Date(Date.now() - DAY_MS) },
    });
    await open(second.body.shareToken as string).expect(404);
    expect((await api.get(`/v1/store/designs/${id}`).expect(200)).body.share).toBeNull();

    const third = await api.post(`/v1/store/designs/${id}/actions/share`).expect(201);
    await api.delete(`/v1/store/designs/${id}/share`).expect(204);
    await open(third.body.shareToken as string).expect(404);
    await open('not-a-token').expect(404);
    expect(
      await ctx.prisma.domainEvent.count({
        where: { aggregateId: id, type: { in: ['design.shared', 'design.share_revoked'] } },
      }),
    ).toBe(4);
  });

  it('serves the designer catalogue, a template and its fonts without signing in', async () => {
    const pub = request(ctx.server);
    await pub.get('/v1/store/designer/catalog').expect(422);
    await pub.get('/v1/store/designer/catalog?product=dev-no-such-product').expect(404);

    const { token } = await customerToken(ctx, 8);
    const admin = await staffToken(ctx, 'admin');
    const fontFile = await uploadFile(ctx, token, 'fake-font', 'design_asset');
    const file = await ctx.prisma.fileObject.findUniqueOrThrow({ where: { publicId: fontFile } });
    const font = await ctx.prisma.designFont.create({
      data: {
        name: '[DEV] Fake Sans',
        fileObjectId: file.id,
        licenceNote: 'fake licence',
        status: 'active',
        // D-284: only OFL fonts licensed for print and embedding reach the studio.
        licence: 'ofl',
        printAllowed: true,
        embeddingAllowed: true,
      },
    });
    const hidden = await ctx.prisma.designFont.create({
      data: { name: '[DEV] Draft Sans', fileObjectId: file.id, licenceNote: 'fake licence' },
    });
    const product = await ctx.prisma.catalogProduct.findUniqueOrThrow({
      where: { slug: 'dev-tuck-end-box' },
      include: { standardSizes: true },
    });
    const semi = await ctx.prisma.semiDesign.create({
      data: {
        catalogProductId: product.id,
        name: '[DEV] ตัวอย่าง',
        status: 'active',
        colours: { create: [{ hex: '#112233', sort: 1 }] },
      },
    });
    const template = await ctx.prisma.semiDesignTemplate.create({
      data: {
        semiDesignId: semi.id,
        standardSizeId: product.standardSizes[0]!.id,
        thumbnailFileId: file.id,
        status: 'active',
        fonts: { create: [{ fontId: font.id }] },
      },
    });

    const catalog = (await pub.get('/v1/store/designer/catalog?product=dev-tuck-end-box').expect(200)).body;
    expect(catalog.product).toMatchObject({ id: productId, slug: 'dev-tuck-end-box' });
    expect(catalog.patterns).toContainEqual(
      expect.objectContaining({ code: 'DEV-RTE', rules: expect.objectContaining({ minWMm: null }) }),
    );
    expect(catalog.rules).toMatchObject({ assetPurpose: 'design_asset', colourMode: 'cmyk' });
    expect(catalog.fonts).toContainEqual({
      id: font.publicId,
      name: '[DEV] Fake Sans',
      url: `/v1/store/designer/fonts/${font.publicId}`,
    });
    expect((catalog.fonts as { id: string }[]).map((f) => f.id)).not.toContain(hidden.publicId);
    expect(catalog.templates).toContainEqual(
      expect.objectContaining({
        id: template.publicId,
        colours: ['#112233'],
        fontIds: [font.publicId],
        hasDesign: false,
      }),
    );
    expect(JSON.stringify(catalog)).not.toMatch(/price|factory|cost/i);

    const templateDesign = await as(ctx, admin)
      .post('/v1/admin/designs', {
        catalogProductId: productId,
        title: 'เทมเพลต',
        schemaVersion: 1,
        document: DOC,
      })
      .expect(201);
    await as(ctx, admin)
      .post(`/v1/admin/catalog/semi-design-templates/${template.publicId}/actions/set-design`, {
        designId: templateDesign.body.id,
      })
      .expect(204);
    const detail = (await pub.get(`/v1/store/designer/templates/${template.publicId}`).expect(200)).body;
    expect(detail).toMatchObject({
      hasDesign: true,
      document: DOC,
      schemaVersion: 1,
      product: { id: productId },
    });

    const served = await pub.get(`/v1/store/designer/fonts/${font.publicId}`).expect(200);
    expect(served.headers['cache-control']).toBe('public, max-age=86400');
    await pub.get(`/v1/store/designer/fonts/${hidden.publicId}`).expect(404);

    await ctx.prisma.semiDesignTemplate.update({ where: { id: template.id }, data: { status: 'inactive' } });
    await pub.get(`/v1/store/designer/templates/${template.publicId}`).expect(404);
  });

  it('lets staff copy a customer’s design to edit it, never the original (U-B0.2)', async () => {
    const { token } = await customerToken(ctx, 9);
    const design = await create(token, 'ของลูกค้า');
    const prepress = await staffToken(ctx, 'prepress');
    const admin = await staffToken(ctx, 'admin');
    const seen = await as(ctx, admin)
      .get(`/v1/admin/designs/${design.body.id as string}`)
      .expect(200);
    expect(seen.body).toMatchObject({ editable: false, owner: { kind: 'customer' } });
    expect(
      (
        await as(ctx, admin)
          .put(`/v1/admin/designs/${design.body.id as string}`, { schemaVersion: 1, document: DOC2 })
          .set('If-Match', seen.headers['etag'] as string)
          .expect(409)
      ).body.code,
    ).toBe('designs.read_only');
    const copy = await as(ctx, prepress)
      .post(`/v1/admin/designs/${design.body.id as string}/actions/copy`, { title: 'สำเนา (fake)' })
      .expect(201);
    expect(copy.body).toMatchObject({
      editable: true,
      owner: { kind: 'staff' },
      document: DOC,
      title: 'สำเนา (fake)',
    });
    expect(copy.body.id).not.toBe(design.body.id);
    expect(
      await ctx.prisma.domainEvent.count({
        where: { type: 'design.copied_by_staff', aggregateId: copy.body.id },
      }),
    ).toBe(1);
    // The customer's design is untouched and not theirs to see as a copy.
    expect(
      (
        await as(ctx, token)
          .get(`/v1/store/designs/${design.body.id as string}`)
          .expect(200)
      ).body.versionNo,
    ).toBe(1);
    await as(ctx, token)
      .get(`/v1/store/designs/${copy.body.id as string}`)
      .expect(404);
    await as(ctx, admin)
      .get(`/v1/admin/orders/${design.body.id as string}/drawings`)
      .expect(404);
  });
});
