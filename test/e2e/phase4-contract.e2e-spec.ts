import { SettingsService } from '@platform/settings/settings.service';
import request from 'supertest';

import { seedDevCorrugate } from '../../prisma/seed/dev-corrugate';
import {
  as,
  bootCommerceApp,
  type CommerceApp,
  customerToken,
  foldingBackToRfq,
  foldingReady,
  setSetting,
  staffToken,
} from '../support/commerce-e2e';

/** UX round 2 Phase 4 contract (D-309, D-313): the storefront's figures and words come from the API. */
describe('Phase 4 contract (e2e)', () => {
  let ctx: CommerceApp;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('publishes the status words, cacheable, with a 304 for a matching ETag (D-313)', async () => {
    const res = await request(ctx.server).get('/v1/store/status-labels').expect(200);
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(res.headers['etag']).toBeDefined();
    const proof = (res.body as { enumName: string; values: { value: string; labelTh: string }[] }[]).find(
      (e) => e.enumName === 'ProofStatus',
    );
    expect(proof?.values).toContainEqual(
      expect.objectContaining({
        value: 'approved',
        labelTh: 'อนุมัติแบบตัวอย่างแล้ว',
        labelAdminTh: 'Proof อนุมัติแล้ว',
      }),
    );
    await request(ctx.server)
      .get('/v1/store/status-labels')
      .set('If-None-Match', res.headers['etag'] as string)
      .expect(304);
  });

  it('states each storefront figure from its source and null without one (D-309)', async () => {
    const first = await request(ctx.server).get('/v1/store/public-config').expect(200);
    expect(first.headers['cache-control']).toBe('public, max-age=300');
    const minFactories = 3;
    const factories = await ctx.prisma.factory.count({
      where: { status: 'active', capabilities: { some: { status: 'active' } } },
    });
    const templates = await ctx.prisma.styleBase.count({
      where: { status: 'active', hidden: false, variants: { some: { publishable: true, status: 'active' } } },
    });
    const channels = (await request(ctx.server).get('/v1/store/support-channels').expect(200)).body as Record<
      string,
      string | null
    >;
    // The settings in force (other suites share the e2e database and may have changed them).
    const settings = ctx.app.get(SettingsService);
    expect(first.body).toMatchObject({
      priceLockDays: (await settings.at('quotes.validity_days')).value,
      claimWindowDays: (await settings.at('claims.window_days')).value,
      proofSlaBusinessDays: null,
      supportHours: null,
      supportReplyMinutes: null,
      templateCount: templates,
      factoryCount: factories >= minFactories ? factories : null,
      contact: { phone: channels['phone'], lineOaId: channels['lineOaId'], email: channels['email'] },
    });
    expect(Object.keys(first.body.minOrderQty).sort()).toEqual(['custom', 'readyStock']);

    await setSetting(ctx, 'artwork.first_proof_business_days', 1);
    await setSetting(ctx, 'storefront.support_hours', { days: 'mon_fri', open: '09:00', close: '18:00' });
    await setSetting(ctx, 'support.reply_minutes', 15);
    const set = await request(ctx.server).get('/v1/store/public-config').expect(200);
    expect(set.body).toMatchObject({
      proofSlaBusinessDays: 1,
      supportHours: { tz: 'Asia/Bangkok', days: 'mon_fri', open: '09:00', close: '18:00' },
      supportReplyMinutes: 15,
    });
    await request(ctx.server)
      .get('/v1/store/public-config')
      .set('If-None-Match', set.headers['etag'] as string)
      .expect(304);
  });

  it('prices a hero choice through the same quote path as /configure (D-310)', async () => {
    await foldingReady(ctx); // the fake factory F9001 the corrugate fixture uses
    await foldingBackToRfq(ctx);
    const fixture = (await ctx.prisma.$transaction((tx) => seedDevCorrugate(tx), { timeout: 60_000 }))
      .fixture;
    const product = await ctx.prisma.catalogProduct.findFirstOrThrow({ where: { slug: 'dev-rsc-carton' } });
    const board = await ctx.prisma.material.findFirstOrThrow({ where: { publicId: fixture.boardPublicId } });
    const ink = await ctx.prisma.inkColour.findFirstOrThrow({
      where: { publicId: fixture.inkColourPublicId },
    });
    const inkLink = await ctx.prisma.catalogProductOption.create({
      data: { catalogProductId: product.id, optionKind: 'ink_colour', optionId: ink.id },
    });
    await ctx.prisma.productType.update({ where: { code: 'corrugated' }, data: { quoteMode: 'instant' } });
    try {
      // The owner's presets as seeded everywhere: no catalogue mapping here, so nothing is offered or priced.
      expect((await request(ctx.server).get('/v1/store/catalog/hero-presets').expect(200)).body).toEqual({
        shapes: [],
        sizes: [],
        materials: [],
        prints: [],
        qtys: [],
        default: null,
        defaultAdjusted: true,
      });
      const choice = {
        shape: 'mailer',
        lengthMm: 400,
        widthMm: 300,
        heightMm: 250,
        material: 'corrE',
        print: 'one',
        qty: 1000,
      };
      const off = await request(ctx.server).post('/v1/store/quotes/actions/preview').send(choice).expect(409);
      expect(off.body.code).toBe('quotes.preview_unavailable');

      await setSetting(ctx, 'catalog.hero_presets', {
        shapes: [{ id: 'mailer', labelTh: 'ไปรษณีย์', productSlug: 'dev-rsc-carton' }],
        sizesMm: [
          { w: 400, d: 300, h: 250 },
          { w: 100, d: 300, h: 600 }, // outside the RSC's size rules: not offered
        ],
        materials: [{ id: 'corrE', labelTh: 'ลูกฟูก E', optionCodes: [board.code] }],
        prints: [
          { id: 'none', labelTh: 'ไม่พิมพ์', optionCodes: [] },
          { id: 'one', labelTh: '1 สี', optionCodes: [ink.code] },
          { id: 'full', labelTh: 'เต็มสี', optionCodes: ['no-such-ink'] },
        ],
        quantities: [1000, 500],
        default: { shape: 'mailer', size: 0, material: 'kraft350', print: 'one', qty: 500 },
      });
      const presets = (await request(ctx.server).get('/v1/store/catalog/hero-presets').expect(200)).body;
      expect(presets).toMatchObject({
        shapes: [
          {
            id: 'mailer',
            labelTh: 'ไปรษณีย์',
            productSlug: 'dev-rsc-carton',
            calculator: 'corrugate',
            qtys: [500, 1000],
          },
        ],
        sizes: [{ id: 'mailer:s0', labelTh: '40×30×25 ซม.', lengthMm: 400, widthMm: 300, heightMm: 250 }],
        materials: [
          {
            id: 'corrE',
            labelTh: 'ลูกฟูก E',
            options: [{ shapeId: 'mailer', materialId: fixture.boardPublicId }],
          },
        ],
        qtys: [500, 1000],
        // kraft350 is not on this product: the nearest offered default.
        default: { shape: 'mailer', sizeId: 'mailer:s0', material: 'corrE', print: 'one', qty: 500 },
        defaultAdjusted: true,
      });
      expect(presets.sizes).toHaveLength(1);
      // A print whose ink is not on the product is not offered.
      expect((presets.prints as { id: string }[]).map((p) => p.id)).toEqual(['none', 'one']);

      const preview = await request(ctx.server)
        .post('/v1/store/quotes/actions/preview')
        .send(choice)
        .expect(200);
      expect(preview.body).toMatchObject({
        currency: 'THB',
        vatIncluded: true,
        presetId: 'mailer:s0',
        unitPrice: expect.stringMatching(/^\d+\.\d{2}$/),
        total: expect.stringMatching(/^\d+\.\d{2}$/),
      });
      expect(Date.parse(preview.body.priceLockUntil)).toBeGreaterThan(Date.now());

      // Parity: the body it priced, and the body /configure sends for the same choices, give the same price.
      const own = await request(ctx.server)
        .post('/v1/store/quotes/actions/calculate')
        .send(preview.body.calculation)
        .expect(200);
      const configure = await request(ctx.server)
        .post('/v1/store/quotes/actions/calculate')
        .send({
          productTypeCode: 'corrugated',
          configuration: {
            catalogProductId: fixture.catalogProductPublicId,
            quantities: [1000],
            design: { graphic: false, structure: false },
            patternId: fixture.rscPatternPublicId,
            l: 400,
            w: 300,
            d: 250,
            materialId: fixture.boardPublicId,
            difficultyLevelId: fixture.difficultyLevelPublicId,
            parts: [
              {
                printFront: [{ inkColourId: fixture.inkColourPublicId, area: 'top' }],
                printBack: [],
                assemblies: [],
              },
            ],
          },
        })
        .expect(200);
      for (const res of [own, configure]) {
        expect(res.body.steps[0]).toMatchObject({
          unitPrice: preview.body.unitPrice,
          grossAmount: preview.body.total,
        });
      }

      // A size of the customer's own is priced too, without a preset id.
      const own2 = await request(ctx.server)
        .post('/v1/store/quotes/actions/preview')
        .send({ ...choice, lengthMm: 410 })
        .expect(200);
      expect(own2.body.presetId).toBeNull();
    } finally {
      await ctx.prisma.productType.update({ where: { code: 'corrugated' }, data: { quoteMode: 'rfq' } });
      await ctx.prisma.catalogProductOption.delete({ where: { id: inkLink.id } });
    }
  });

  it('shows customer stories only when at least 3 are approved with written permission (D-311)', async () => {
    const run = Date.now().toString(36);
    const marketing = await staffToken(ctx, 'marketing');
    const owner = await ctx.prisma.user.findFirstOrThrow({ where: { email: 'marketing@example.invalid' } });
    const file = (name: string, mimeType: string) =>
      ctx.prisma.fileObject.create({
        data: {
          bucket: 'test',
          storageKey: `cms/e2e/${run}/${name}`,
          originalName: name,
          mimeType,
          sizeBytes: 1024n,
          uploadStatus: 'uploaded',
          scanStatus: 'clean',
          ownerUserId: owner.id,
        },
      });
    const home = async () =>
      (await request(ctx.server).get('/v1/store/cms/home').expect(200)).body as { cases: unknown[] };
    await ctx.prisma.homeCustomerCase.updateMany({ data: { deletedAt: new Date() } });
    expect((await home()).cases).toEqual([]);

    const story = async (n: number, withConsent: boolean) => {
      const photo = await file(`photo-${n}.jpg`, 'image/jpeg');
      const consent = withConsent ? await file(`consent-${n}.pdf`, 'application/pdf') : null;
      return as(ctx, marketing)
        .post('/v1/admin/cms/home-cases', {
          brandNameTh: `ร้านทดสอบ ${n} (fake)`,
          provinceTh: 'เชียงใหม่',
          productTh: 'กล่องไปรษณีย์',
          quantity: 500 * (n + 1),
          leadTimeDays: 9,
          quoteTh: 'ข้อความทดสอบ',
          photoFileId: photo.publicId,
          ...(consent ? { consentFileId: consent.publicId } : {}),
          sort: n,
        })
        .expect(201);
    };
    const approve = (created: request.Response) =>
      as(ctx, marketing)
        .post(`/v1/admin/cms/home-cases/${created.body.id}/actions/approve`, {})
        .set('If-Match', created.headers['etag'] as string);

    const noConsent = await story(0, false);
    expect((await approve(noConsent).expect(422)).body.code).toBe('cms.case_consent_required');
    const customer = (await customerToken(ctx, 91)).token;
    await as(ctx, customer)
      .post(`/v1/admin/cms/home-cases/${noConsent.body.id}/actions/approve`, {})
      .expect(403);

    const approved: request.Response[] = [];
    for (const n of [1, 2]) approved.push(await approve(await story(n, true)).expect(200));
    expect(approved[0]!.body).toMatchObject({ status: 'approved', approvedAt: expect.any(String) });
    expect((await home()).cases).toEqual([]); // two are not enough
    approved.push(await approve(await story(3, true)).expect(200));
    const shown = (await home()).cases as { brandNameTh: string; qty: number; photoUrl: string }[];
    expect(shown.map((c) => c.qty)).toEqual([1000, 1500, 2000]);
    expect(shown[0]!.photoUrl).toMatch(/^\/v1\/store\/catalog\/images\/[0-9a-f-]{36}$/);
    expect(JSON.stringify(shown)).not.toMatch(/consent/i);

    // Editing what an approved story says takes it back to draft; withdrawing takes it off at once.
    const edited = await as(ctx, marketing)
      .patch(`/v1/admin/cms/home-cases/${approved[0]!.body.id}`)
      .set('If-Match', approved[0]!.headers['etag'] as string)
      .send({ quoteTh: 'ข้อความทดสอบใหม่' })
      .expect(200);
    expect(edited.body).toMatchObject({ status: 'draft', approvedAt: null });
    expect((await home()).cases).toEqual([]);
    await approve(edited).expect(200);
    expect((await home()).cases).toHaveLength(3);
    const withdrawn = await as(ctx, marketing)
      .post(`/v1/admin/cms/home-cases/${approved[1]!.body.id}/actions/withdraw`, {})
      .set('If-Match', approved[1]!.headers['etag'] as string)
      .expect(200);
    expect(withdrawn.body.status).toBe('withdrawn');
    expect((await home()).cases).toEqual([]);
  });

  it('lists the home photos in the shape the home-photos section holds, leaving out malformed ones', async () => {
    const id = '0192f3a0-7c1e-7d2a-9b1f-0000000c5009';
    const img = `/v1/store/catalog/images/${id}`;
    await ctx.prisma.homeSection.updateMany({
      where: { slug: 'home-photos' },
      data: { deletedAt: new Date() },
    });
    await ctx.prisma.homeSection.create({
      data: {
        slug: 'home-photos',
        kind: 'custom',
        status: 'published',
        config: {
          hero: { url: img, alt: { th: 'กล่องบนโต๊ะ' }, caption: { th: 'กล่องไปรษณีย์' } },
          mosaic: [
            null,
            { url: img, alt: { th: 'ภาพสอง' }, caption: null },
            { url: 'https://example.invalid/x.jpg', alt: { th: 'นอก' } },
          ],
          quality: { url: img, alt: { th: '' } },
          templates: { 'PK-TE-01': { url: img, alt: { th: 'ฝาเสียบ' }, caption: null } },
        },
      },
    });
    expect((await request(ctx.server).get('/v1/store/cms/home').expect(200)).body.photos).toEqual([
      { url: img, altTh: 'กล่องบนโต๊ะ', captionTh: 'กล่องไปรษณีย์', position: 'hero' },
      { url: img, altTh: 'ภาพสอง', captionTh: null, position: 'mosaic-2' },
      { url: img, altTh: 'ฝาเสียบ', captionTh: null, position: 'template-PK-TE-01' },
    ]);
    await ctx.prisma.homeSection.updateMany({
      where: { slug: 'home-photos' },
      data: { deletedAt: new Date() },
    });
  });
});
