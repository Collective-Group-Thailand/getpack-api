import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import { as, customerToken, foldingBackToRfq, foldingReady, staffToken } from '../support/commerce-e2e';
import { bootFulfilmentApp, factoryToken, type FulfilmentApp } from '../support/fulfilment-e2e';

/** U2.9 partner knowledge base (D-295): partner articles for partner users only, never in the store. */
describe('partner knowledge base (e2e, U2.9)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  it('serves partner articles to partner users and keeps them out of the store', async () => {
    const marketing = await staffToken(ctx, 'marketing');
    const slug = `kb-e2e-${randomUUID().slice(0, 8)}`;
    const created = await as(ctx, marketing)
      .post('/v1/admin/cms/articles', {
        slug,
        titleTh: 'มาตรฐานภาพถ่ายก่อนส่งงาน',
        titleEn: 'Photos before shipping',
        audience: 'partner',
        status: 'published',
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect(created.body.audience).toBe('partner');

    // Only categories of the article's audience.
    const categories = await as(ctx, marketing)
      .get('/v1/admin/cms/article-categories?audience=partner')
      .expect(200);
    const qc = (categories.body.data as { id: string; slug: string }[]).find(
      (c) => c.slug === 'kb-qc-photo-standard',
    )!;
    const publicCategory = await as(ctx, marketing)
      .post('/v1/admin/cms/article-categories', {
        slug: `pub-${slug}`,
        nameTh: 'หมวดสาธารณะ',
        nameEn: 'Public',
        status: 'published',
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    await as(ctx, marketing)
      .put(`/v1/admin/cms/articles/${created.body.id as string}/categories`, {
        categoryIds: [publicCategory.body.id],
      })
      .set('If-Match', created.headers['etag'] as string)
      .expect(422);
    await as(ctx, marketing)
      .put(`/v1/admin/cms/articles/${created.body.id as string}/categories`, { categoryIds: [qc.id] })
      .set('If-Match', created.headers['etag'] as string)
      .expect(200);

    const partner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_planner', 181);
    const kbCategories = await as(ctx, partner).get('/v1/partner/knowledge-base/categories').expect(200);
    expect((kbCategories.body as { slug: string }[]).map((c) => c.slug)).toEqual(
      expect.arrayContaining([
        'kb-print-spec',
        'kb-file-handling',
        'kb-qc-photo-standard',
        'kb-packing-labels',
        'kb-payouts',
      ]),
    );
    const listed = await as(ctx, partner)
      .get('/v1/partner/knowledge-base/articles?category=kb-qc-photo-standard&perPage=100')
      .expect(200);
    expect((listed.body.data as { slug: string }[]).map((a) => a.slug)).toContain(slug);
    const article = await as(ctx, partner).get(`/v1/partner/knowledge-base/articles/${slug}`).expect(200);
    expect(article.body).toMatchObject({ slug, categorySlugs: ['kb-qc-photo-standard'] });

    // The store never serves it: not listed, not readable, not searchable, its categories not listed.
    const store = await request(ctx.server).get('/v1/store/catalog/articles?perPage=100').expect(200);
    expect((store.body.data as { slug: string }[]).map((a) => a.slug)).not.toContain(slug);
    await request(ctx.server).get(`/v1/store/catalog/articles/${slug}`).expect(404);
    const storeCategories = await request(ctx.server).get('/v1/store/catalog/article-categories').expect(200);
    expect((storeCategories.body as { slug: string }[]).some((c) => c.slug.startsWith('kb-'))).toBe(false);
    const search = await request(ctx.server)
      .get(`/v1/store/catalog/search?q=${encodeURIComponent('มาตรฐานภาพถ่ายก่อนส่งงาน')}`)
      .expect(200);
    expect(JSON.stringify(search.body)).not.toContain(slug);
    // And a customer token is refused on the partner surface.
    const customer = (await customerToken(ctx, 181)).token;
    await as(ctx, customer).get('/v1/partner/knowledge-base/articles').expect(403);
  });
});
