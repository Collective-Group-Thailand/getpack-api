import { PrismaService } from '@database/prisma.service';
import { type FakeObjectStorage } from '@integrations/s3/fake-object-storage';
import { OBJECT_STORAGE } from '@integrations/s3/object-storage.port';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { seedDev } from '../../prisma/seed/dev-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from '../support/e2e';

/** A 1×1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

/** CMS, showcase, semi-designs and geography administration (B2.1, D-005, D-161). */
describe('CMS and geography admin (e2e, B2.1)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let storage: FakeObjectStorage;
  const tokens: Record<string, string> = {};
  const run = Date.now().toString(36);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    storage = app.get(OBJECT_STORAGE);
    await seedDev(prisma, E2E_DEV_PASSWORD);
    for (const role of ['admin', 'marketing']) {
      const res = await request(server)
        .post('/v1/auth/staff/login')
        .send({ email: `${role}@example.invalid`, password: E2E_DEV_PASSWORD })
        .expect(200);
      tokens[role] = res.body.accessToken as string;
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  const as = (role: string) => ({
    get: (url: string) => request(server).get(url).auth(tokens[role]!, { type: 'bearer' }),
    post: (url: string, body: object) =>
      request(server).post(url).auth(tokens[role]!, { type: 'bearer' }).send(body),
    patch: (url: string, body: object, etag: string) =>
      request(server).patch(url).auth(tokens[role]!, { type: 'bearer' }).set('If-Match', etag).send(body),
    put: (url: string, body: object, etag: string) =>
      request(server).put(url).auth(tokens[role]!, { type: 'bearer' }).set('If-Match', etag).send(body),
    delete: (url: string, etag: string) =>
      request(server).delete(url).auth(tokens[role]!, { type: 'bearer' }).set('If-Match', etag),
  });
  const admin = as('admin');
  const marketing = as('marketing');

  async function image(role = 'marketing'): Promise<string> {
    const presigned = await as(role)
      .post('/v1/admin/files/presign', {
        purpose: 'evidence',
        fileName: 'banner.png',
        mimeType: 'image/png',
        sizeBytes: PNG.length,
      })
      .expect(201);
    const row = await prisma.fileObject.findUniqueOrThrow({
      where: { publicId: presigned.body.fileId as string },
    });
    storage.putDirect(row.storageKey, PNG, 'image/png');
    await as(role).post(`/v1/admin/files/${presigned.body.fileId}/actions/complete`, {}).expect(200);
    return presigned.body.fileId as string;
  }

  it('lets Marketing run banners, with soft delete hiding the row everywhere', async () => {
    const banner = await marketing
      .post('/v1/admin/cms/banners', {
        position: 'home_hero',
        title: `แบนเนอร์ทดสอบ ${run}`,
        desktopFileId: await image(),
        targetUrl: '/th/products',
        validFrom: '2026-10-01T00:00:00+07:00',
        validTo: '2026-10-31T23:59:59+07:00',
      })
      .expect(201);
    expect(banner.body).toMatchObject({ status: 'draft', validFrom: '2026-10-01T00:00:00+07:00' });

    await marketing
      .post('/v1/admin/cms/banners', {
        position: 'popup',
        title: 'bad window',
        desktopFileId: await image(),
        targetUrl: 'javascript:alert(1)',
      })
      .expect(422);

    await marketing
      .delete(`/v1/admin/cms/banners/${banner.body.id}`, banner.headers['etag'] as string)
      .expect(204);
    await marketing.get(`/v1/admin/cms/banners/${banner.body.id}`).expect(404);
    const list = await marketing.get(`/v1/admin/cms/banners?q=${run}`).expect(200);
    expect(list.body.data).toEqual([]);
    expect(
      await prisma.banner.count({ where: { publicId: banner.body.id as string, deletedAt: { not: null } } }),
    ).toBe(1);
  });

  it('stamps publishedAt on the first publication only', async () => {
    const article = await marketing
      .post('/v1/admin/cms/articles', { slug: `e2e-article-${run}`, titleTh: 'บทความทดสอบ' })
      .expect(201);
    expect(article.body.publishedAt).toBeNull();
    const published = await marketing
      .patch(
        `/v1/admin/cms/articles/${article.body.id}`,
        { status: 'published' },
        article.headers['etag'] as string,
      )
      .expect(200);
    const firstPublishedAt = published.body.publishedAt as string;
    expect(firstPublishedAt).not.toBeNull();
    const edited = await marketing
      .patch(
        `/v1/admin/cms/articles/${article.body.id}`,
        { status: 'published', titleEn: 'Test' },
        published.headers['etag'] as string,
      )
      .expect(200);
    expect(edited.body.publishedAt).toBe(firstPublishedAt);

    const category = await marketing
      .post('/v1/admin/cms/article-categories', {
        slug: `e2e-cat-${run}`,
        nameTh: 'หมวด',
        nameEn: 'Category',
      })
      .expect(201);
    const linked = await marketing
      .put(
        `/v1/admin/cms/articles/${article.body.id}/categories`,
        { categoryIds: [category.body.id] },
        edited.headers['etag'] as string,
      )
      .expect(200);
    expect(linked.body.categoryIds).toEqual([category.body.id]);
    const filtered = await marketing.get(`/v1/admin/cms/articles?categoryId=${category.body.id}`).expect(200);
    expect((filtered.body.data as { id: string }[]).map((a) => a.id)).toEqual([article.body.id]);
  });

  it('reorders home sections only with the complete list', async () => {
    const a = await marketing
      .post('/v1/admin/cms/home-sections', { slug: `e2e-a-${run}`, kind: 'custom' })
      .expect(201);
    const b = await marketing
      .post('/v1/admin/cms/home-sections', { slug: `e2e-b-${run}`, kind: 'articles' })
      .expect(201);
    const all = (
      await prisma.homeSection.findMany({ where: { deletedAt: null }, orderBy: { sort: 'asc' } })
    ).map((s) => s.publicId);
    await marketing
      .post('/v1/admin/cms/home-sections/actions/reorder', { ids: [a.body.id] })
      .expect(all.length === 1 ? 200 : 422);
    const order = [b.body.id as string, ...all.filter((id) => id !== b.body.id)];
    const res = await marketing
      .post('/v1/admin/cms/home-sections/actions/reorder', { ids: order })
      .expect(200);
    expect((res.body as { id: string }[]).map((s) => s.id)).toEqual(order);
  });

  let types = 0;
  async function productType() {
    const n = ++types;
    const category = await prisma.productCategory.create({
      data: { code: `e2e_cms_${run}_${n}`, nameTh: 'x', nameEn: 'x' },
    });
    return prisma.productType.create({
      data: { code: `e2e_cms_type_${run}_${n}`, categoryId: category.id, nameTh: 'x', nameEn: 'x' },
    });
  }

  it('attaches videos to a subject of the given type and filters by it', async () => {
    const subject = await prisma.catalogProduct.create({
      data: { slug: `e2e-video-${run}`, nameTh: 'x', nameEn: 'x', productTypeId: (await productType()).id },
    });
    const video = await marketing
      .post('/v1/admin/cms/videos', {
        provider: 'youtube',
        url: 'https://www.youtube.com/watch?v=example',
        subjectType: 'catalog_product',
        subjectId: subject.publicId,
      })
      .expect(201);
    expect(video.body.subjectId).toBe(subject.publicId);
    await marketing
      .post('/v1/admin/cms/videos', {
        provider: 'youtube',
        url: 'https://www.youtube.com/watch?v=example',
        subjectType: 'article',
        subjectId: subject.publicId,
      })
      .expect(422);
    const list = await marketing
      .get(`/v1/admin/cms/videos?subjectType=catalog_product&subjectId=${subject.publicId}`)
      .expect(200);
    expect((list.body.data as { id: string }[]).map((v) => v.id)).toContain(video.body.id);
  });

  it('keeps a semi-design template on a size of the same catalogue product', async () => {
    const type = await productType();
    const make = (slug: string) =>
      admin
        .post('/v1/admin/catalog/catalog-products', {
          productTypeId: type.publicId,
          slug,
          nameTh: 'x',
          nameEn: 'x',
        })
        .expect(201);
    const productA = await make(`e2e-sd-a-${run}`);
    const productB = await make(`e2e-sd-b-${run}`);
    const size = (productId: string) =>
      admin
        .post('/v1/admin/catalog/standard-sizes', {
          catalogProductId: productId,
          code: 'S',
          name: 'S',
          lengthMm: 100,
          widthMm: 100,
          heightMm: 50,
        })
        .expect(201);
    const sizeB = await size(productB.body.id as string);
    const sizeA = await size(productA.body.id as string);
    const design = await admin
      .post('/v1/admin/catalog/semi-designs', { catalogProductId: productA.body.id, name: 'มินิมอล' })
      .expect(201);
    const thumbnail = await image('admin');
    await admin
      .post('/v1/admin/catalog/semi-design-templates', {
        semiDesignId: design.body.id,
        standardSizeId: sizeB.body.id,
        thumbnailFileId: thumbnail,
      })
      .expect(422);
    await admin
      .post('/v1/admin/catalog/semi-design-templates', {
        semiDesignId: design.body.id,
        standardSizeId: sizeA.body.id,
        thumbnailFileId: thumbnail,
      })
      .expect(201);
    const palette = await admin
      .put(
        `/v1/admin/catalog/semi-designs/${design.body.id}/colours`,
        { colours: ['#000000', '#ffffff'] },
        design.headers['etag'] as string,
      )
      .expect(200);
    expect(palette.body.colours).toEqual(['#000000', '#FFFFFF']);
  });

  it('keeps geography edits to geography.manage holders (D-161)', async () => {
    const province = await admin
      .post('/v1/admin/geography/provinces', {
        code: `G${run}`.slice(0, 12),
        nameTh: 'จังหวัดทดสอบ',
        nameEn: 'Test',
      })
      .expect(201);
    await marketing
      .post('/v1/admin/geography/provinces', { code: `M${run}`.slice(0, 12), nameTh: 'x', nameEn: 'x' })
      .expect(403);
    const district = await admin
      .post('/v1/admin/geography/districts', {
        provinceId: province.body.id,
        code: `D${run}`.slice(0, 12),
        nameTh: 'อำเภอ',
        nameEn: 'District',
      })
      .expect(201);
    await admin
      .post('/v1/admin/geography/subdistricts', {
        districtId: district.body.id,
        code: `S${run}`.slice(0, 12),
        nameTh: 'ตำบล',
        nameEn: 'Sub',
        postcode: '1234',
      })
      .expect(422);
    const sub = await admin
      .post('/v1/admin/geography/subdistricts', {
        districtId: district.body.id,
        code: `S${run}`.slice(0, 12),
        nameTh: 'ตำบล',
        nameEn: 'Sub',
        postcode: '12345',
      })
      .expect(201);
    const byPostcode = await admin.get('/v1/admin/geography/subdistricts?postcode=12345').expect(200);
    expect((byPostcode.body.data as { id: string }[]).map((s) => s.id)).toContain(sub.body.id);
  });
});
