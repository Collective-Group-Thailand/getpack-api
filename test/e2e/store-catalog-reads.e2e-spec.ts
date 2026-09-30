import request from 'supertest';

import { as, bootCommerceApp, type CommerceApp, setSetting, staffToken } from '../support/commerce-e2e';

/** U-B0.1 slice 2: categories, category filter, product FAQs, FAQ search, sitemap, support channels. */
describe('store catalogue reads (e2e, U-B0.1)', () => {
  let ctx: CommerceApp;
  let marketing: string;
  const run = Date.now().toString(36);
  const codes = { parent: `ub01_parent_${run}`, child: `ub01_child_${run}`, empty: `ub01_empty_${run}` };
  let productSlug: string;
  let productId: string;
  let otherSlug: string;
  let sku: string;
  let faqId: string;
  const question = `ถามเรื่องกล่องพิเศษ${run}`;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    marketing = await staffToken(ctx, 'marketing');
    const { prisma } = ctx;
    const parent = await prisma.productCategory.create({
      data: { code: codes.parent, nameTh: 'แม่', nameEn: 'Parent', status: 'active', sort: 1 },
    });
    const child = await prisma.productCategory.create({
      data: {
        code: codes.child,
        nameTh: 'ลูก',
        nameEn: 'Child',
        status: 'active',
        parentId: parent.id,
        sort: 2,
      },
    });
    await prisma.productCategory.create({
      data: { code: codes.empty, nameTh: 'ว่าง', nameEn: 'Empty', status: 'active' },
    });
    const type = await prisma.productType.create({
      data: { code: `ub01_type_${run}`, categoryId: child.id, nameTh: 'ท', nameEn: 'T', status: 'active' },
    });
    const product = await prisma.catalogProduct.create({
      data: {
        productTypeId: type.id,
        slug: `ub01-box-${run}`,
        nameTh: 'กล่อง',
        nameEn: 'Box',
        status: 'active',
      },
    });
    productSlug = product.slug;
    productId = product.publicId;
    const hidden = await prisma.seoPage.create({
      data: { pageKey: `ub01-noindex-${run}`, titleTh: 'ซ่อน', noindex: true },
    });
    const other = await prisma.catalogProduct.create({
      data: {
        productTypeId: type.id,
        slug: `ub01-hidden-${run}`,
        nameTh: 'ซ่อน',
        nameEn: 'Hidden',
        status: 'active',
        seoPageId: hidden.id,
      },
    });
    otherSlug = other.slug;
    sku = `UB01-${run}`.toUpperCase();
    await prisma.stockProduct.create({
      data: {
        productTypeId: type.id,
        sku,
        nameTh: 'สต็อก',
        nameEn: 'Stock',
        unit: 'piece',
        status: 'active',
      },
    });
    const faq = await prisma.faq.create({
      data: { questionTh: question, answerTh: 'คำตอบ', status: 'published', sort: 5 },
    });
    faqId = faq.publicId;
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('lists browsable categories with their parent, not empty ones (D-228)', async () => {
    const res = await request(ctx.server).get('/v1/store/catalog/product-categories').expect(200);
    const mine = (res.body as { code: string; parentCode: string | null }[]).filter((c) =>
      Object.values(codes).includes(c.code),
    );
    expect(mine).toEqual([
      expect.objectContaining({ code: codes.parent, parentCode: null }),
      expect.objectContaining({ code: codes.child, parentCode: codes.parent }),
    ]);
  });

  it('filters products and stock products by a parent category, including sub-categories', async () => {
    const products = await request(ctx.server)
      .get(`/v1/store/catalog/products?category=${codes.parent}&perPage=100`)
      .expect(200);
    const slugs = (products.body.data as { slug: string }[]).map((p) => p.slug);
    expect(slugs.sort()).toEqual([otherSlug, productSlug].sort());
    const stock = await request(ctx.server)
      .get(`/v1/store/catalog/stock-products?category=${codes.child}`)
      .expect(200);
    expect((stock.body.data as { sku: string }[]).map((s) => s.sku)).toEqual([sku]);
    const none = await request(ctx.server)
      .get(`/v1/store/catalog/products?category=${codes.empty}`)
      .expect(200);
    expect(none.body.meta.total).toBe(0);
  });

  it('links a FAQ to a product in the CMS and shows it on the product page', async () => {
    await request(ctx.server).get(`/v1/store/catalog/products/${productSlug}/faqs`).expect(200, []);
    const api = as(ctx, marketing);
    const current = await api.get(`/v1/admin/cms/faqs/${faqId}`).expect(200);
    const linked = await api
      .put(`/v1/admin/cms/faqs/${faqId}/catalog-products`, { catalogProductIds: [productId] })
      .set('If-Match', current.headers['etag'] as string)
      .expect(200);
    expect(linked.body.catalogProductIds).toEqual([productId]);
    const audit = await ctx.prisma.auditLog.count({
      where: { resourceType: 'faq', resourcePublicId: faqId },
    });
    expect(audit).toBeGreaterThan(0);

    const faqs = await request(ctx.server).get(`/v1/store/catalog/products/${productSlug}/faqs`).expect(200);
    expect(faqs.body).toEqual([
      { questionTh: question, questionEn: null, answerTh: 'คำตอบ', answerEn: null },
    ]);
    await request(ctx.server).get(`/v1/store/catalog/products/no-such-${run}/faqs`).expect(404);
  });

  it('finds published FAQs in search', async () => {
    const res = await request(ctx.server)
      .get(`/v1/store/catalog/search?q=${encodeURIComponent(question)}`)
      .expect(200);
    expect(res.body.hits).toContainEqual(
      expect.objectContaining({ kind: 'faq', key: faqId, titleTh: question }),
    );
  });

  it('lists indexable pages for the sitemap, without noindex pages', async () => {
    const res = await request(ctx.server).get('/v1/store/sitemap').expect(200);
    const entries = res.body as { kind: string; key: string; lastModified: string }[];
    expect(entries).toContainEqual(expect.objectContaining({ kind: 'catalog_product', key: productSlug }));
    expect(entries).toContainEqual(expect.objectContaining({ kind: 'stock_product', key: sku }));
    expect(entries).toContainEqual(expect.objectContaining({ kind: 'category', key: codes.parent }));
    expect(entries.some((e) => e.key === otherSlug || e.key === codes.empty)).toBe(false);
  });

  it('serves the support channels from the CS Lead setting (D-221), null until set', async () => {
    const owner = await ctx.prisma.setting.findFirstOrThrow({
      where: { key: 'storefront.support_channels' },
    });
    expect(owner.ownerRoleKey).toBe('cs_lead');
    await request(ctx.server)
      .get('/v1/store/support-channels')
      .expect(200, { lineOaId: null, phone: null, email: null, hours: null });
    await setSetting(ctx, 'storefront.support_channels', {
      lineOaId: '@packio-test',
      phone: '0800000000',
      email: 'support@example.com',
      hours: '',
    });
    const res = await request(ctx.server).get('/v1/store/support-channels').expect(200);
    expect(res.body).toEqual({
      lineOaId: '@packio-test',
      phone: '0800000000',
      email: 'support@example.com',
      hours: null,
    });
  });
});
