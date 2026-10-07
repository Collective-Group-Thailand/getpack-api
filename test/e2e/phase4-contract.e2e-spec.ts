import request from 'supertest';

import { seedDevCorrugate } from '../../prisma/seed/dev-corrugate';
import {
  bootCommerceApp,
  type CommerceApp,
  foldingBackToRfq,
  foldingReady,
  setSetting,
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
    expect(first.body).toMatchObject({
      priceLockDays: 15,
      claimWindowDays: 7,
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
      // Not configured: nothing offered, nothing priced.
      await setSetting(ctx, 'catalog.hero_presets', {
        shapes: [],
        materials: [],
        prints: [],
        quantities: [1000],
      });
      expect((await request(ctx.server).get('/v1/store/catalog/hero-presets').expect(200)).body).toEqual({
        shapes: [],
        sizes: [],
        materials: [],
        prints: [],
        qtys: [],
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
        shapes: [{ id: 'mailer', productSlug: 'dev-rsc-carton', sizeCodes: ['M'] }],
        materials: [{ id: 'corrE', optionCodes: [board.code] }],
        prints: [
          { id: 'none', optionCodes: [] },
          { id: 'one', optionCodes: [ink.code] },
          { id: 'full', optionCodes: ['no-such-ink'] },
        ],
        quantities: [1000, 500],
      });
      const presets = (await request(ctx.server).get('/v1/store/catalog/hero-presets').expect(200)).body;
      expect(presets).toMatchObject({
        shapes: [{ id: 'mailer', productSlug: 'dev-rsc-carton', calculator: 'corrugate' }],
        sizes: [{ id: 'mailer:M', lengthMm: 400, widthMm: 300, heightMm: 250 }],
        materials: [{ id: 'corrE', options: [{ shapeId: 'mailer', materialId: fixture.boardPublicId }] }],
        qtys: [500, 1000],
      });
      // A print whose ink is not on the product is not offered.
      expect((presets.prints as { id: string }[]).map((p) => p.id)).toEqual(['none', 'one']);

      const preview = await request(ctx.server)
        .post('/v1/store/quotes/actions/preview')
        .send(choice)
        .expect(200);
      expect(preview.body).toMatchObject({
        currency: 'THB',
        vatIncluded: true,
        presetId: 'mailer:M',
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
});
