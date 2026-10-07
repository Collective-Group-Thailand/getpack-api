import request from 'supertest';

import { bootCommerceApp, type CommerceApp, setSetting } from '../support/commerce-e2e';

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
});
