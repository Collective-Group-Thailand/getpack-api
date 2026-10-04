import { PrismaService } from '@database/prisma.service';
import { type FakeObjectStorage } from '@integrations/s3/fake-object-storage';
import { OBJECT_STORAGE } from '@integrations/s3/object-storage.port';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

/** Public catalogue reads (B2.1): visibility, configurator detail, search, media, feed. */
describe('store catalogue (e2e, B2.1)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let storage: FakeObjectStorage;
  const run = Date.now().toString(36);
  const word = `ซูเปอร์กล่อง${run}`;

  let active: { slug: string; imageFileId: string };
  let draftSlug: string;
  let sku: string;

  async function file(scanStatus: 'clean' | 'pending' = 'clean') {
    const row = await prisma.fileObject.create({
      data: {
        bucket: 'test',
        storageKey: `standard/e2e/${run}/${Math.random()}`,
        originalName: 'image.png',
        mimeType: 'image/png',
        sizeBytes: BigInt(PNG.length),
        uploadStatus: 'uploaded',
        scanStatus,
        sha256: Buffer.alloc(32, 1),
      },
    });
    storage.putDirect(row.storageKey, PNG, 'image/png');
    return row;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    // Bound to IPv4 loopback so a Docker-published port can never shadow the test server.
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    storage = app.get(OBJECT_STORAGE);

    const category = await prisma.productCategory.create({
      data: { code: `store_${run}`, nameTh: 'x', nameEn: 'x' },
    });
    const type = await prisma.productType.create({
      data: {
        code: `store_type_${run}`,
        categoryId: category.id,
        nameTh: 'ประเภท',
        nameEn: 'Type',
        status: 'active',
      },
    });
    const pattern = await prisma.pattern.create({
      data: {
        productTypeId: type.id,
        code: `ST-${run}`,
        name: 'ฝาเสียบ',
        status: 'active',
        constraints: { minW: 30 },
      },
    });
    const material = await prisma.material.create({
      data: {
        code: `st-art-${run}`,
        kind: 'paper',
        nameTh: 'อาร์ตการ์ด',
        nameEn: 'Art card',
        gsm: 350,
        status: 'active',
      },
    });
    const hiddenMaterial = await prisma.material.create({
      data: { code: `st-draft-${run}`, kind: 'paper', nameTh: 'ร่าง', nameEn: 'Draft', status: 'draft' },
    });
    const image = await file();
    const product = await prisma.catalogProduct.create({
      data: {
        productTypeId: type.id,
        slug: `super-box-${run}`,
        nameTh: `${word} ฝาเสียบ`,
        nameEn: `Super box ${run}`,
        status: 'active',
        patterns: { create: { patternId: pattern.id } },
        options: {
          create: [
            { optionKind: 'material', optionId: material.id, isDefault: true },
            { optionKind: 'material', optionId: hiddenMaterial.id },
          ],
        },
        images: { create: { fileObjectId: image.id } },
        standardSizes: {
          create: [
            { code: 'S', name: 'S', lengthMm: 100, widthMm: 100, heightMm: 50, status: 'active' },
            { code: 'X', name: 'draft', lengthMm: 1, widthMm: 1, heightMm: 1, status: 'draft' },
          ],
        },
      },
    });
    active = { slug: product.slug, imageFileId: image.publicId };
    const draft = await prisma.catalogProduct.create({
      data: {
        productTypeId: type.id,
        slug: `draft-box-${run}`,
        nameTh: `${word} ร่าง`,
        nameEn: 'Draft',
        status: 'draft',
      },
    });
    draftSlug = draft.slug;

    const colour = await prisma.stockAttributeValue.create({
      data: { attribute: 'colour', code: `clear-${run}`, nameTh: 'ใส', nameEn: 'Clear', status: 'active' },
    });
    sku = `E2E-${run}`.toUpperCase();
    const code = `E2ESTORE${run}`.slice(0, 20).toUpperCase();
    const identity = { juristicType: 'company' as const, taxId: '0000000000019', branchCode: '00013' };
    const factory = await prisma.factory.create({
      data: {
        code,
        legalName: `${code} (fake)`,
        ...identity,
        vendor: { create: { kind: 'factory', legalName: `${code} (fake)`, ...identity } },
      },
    });
    const stock = await prisma.stockProduct.create({
      data: {
        productTypeId: type.id,
        sku,
        nameTh: `ขวด ${word}`,
        nameEn: 'Bottle',
        unit: 'piece',
        status: 'active',
        attributes: { create: { attribute: 'colour', valueId: colour.id } },
        images: { create: { fileObjectId: (await file()).id } },
        levels: { create: { factoryId: factory.id, onHand: 10, reserved: 2 } },
        priceSummary: { create: { zoneCode: null, minUnitPriceWithDelivery: 3.456, computedAt: new Date() } },
      },
    });
    expect(stock.id).toBeDefined();
  });

  afterAll(async () => {
    await app?.close();
  });

  const get = (url: string) => request(server).get(url);

  it('lists only active products of active types, anonymously and cacheable', async () => {
    const res = await get(`/v1/store/catalog/products?q=${encodeURIComponent(word)}`).expect(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect((res.body.data as { slug: string }[]).map((p) => p.slug)).toEqual([active.slug]);
    expect(res.body.data[0].imageUrl).toBe(`/v1/store/catalog/images/${active.imageFileId}`);
    await get(`/v1/store/catalog/products/${draftSlug}`).expect(404);
  });

  it('returns the configurator detail with active options and sizes only', async () => {
    const res = await get(`/v1/store/catalog/products/${active.slug}`).expect(200);
    expect(res.body.patterns).toEqual([
      expect.objectContaining({ code: `ST-${run}`, constraints: { minW: 30 } }),
    ]);
    expect(res.body.optionGroups).toEqual([
      {
        kind: 'material',
        options: [
          expect.objectContaining({
            code: `st-art-${run}`,
            isDefault: true,
            attributes: expect.objectContaining({ gsm: 350 }),
          }),
        ],
      },
    ]);
    expect((res.body.standardSizes as { code: string }[]).map((s) => s.code)).toEqual(['S']);
    // No factory or buy-side data (D-050); the card's D-220 starting price is the customer's own price (U-B4).
    expect(JSON.stringify(res.body)).not.toMatch(/factory|buy.?price|cost|margin/i);
  });

  it('filters stock products by attribute and reports availability without factories', async () => {
    const res = await get(`/v1/store/catalog/stock-products?attributes=colour:clear-${run}`).expect(200);
    expect(res.body.data).toEqual([expect.objectContaining({ sku, inStock: true })]);
    await get(`/v1/store/catalog/stock-products?attributes=colour:nope-${run}`)
      .expect(200)
      .expect((r) => expect(r.body.data).toEqual([]));
    await get('/v1/store/catalog/stock-products?attributes=bad filter').expect(422);
  });

  it('searches with trigrams across products and stock products', async () => {
    const res = await get(`/v1/store/catalog/search?q=${encodeURIComponent(word)}`).expect(200);
    const keys = (res.body.hits as { kind: string; key: string }[]).map((h) => `${h.kind}:${h.key}`);
    expect(keys).toEqual(expect.arrayContaining([`catalog_product:${active.slug}`, `stock_product:${sku}`]));
    expect(keys).not.toContain(`catalog_product:${draftSlug}`);
    // Each search is logged for analytics (B2.3, schema-design §3.5).
    const logged = await prisma.searchLog.findFirst({ where: { keyword: word }, orderBy: { id: 'desc' } });
    expect(logged).toMatchObject({ keyword: word, channel: 'web', resultsCount: res.body.hits.length });
    await get('/v1/store/catalog/search?q=x').expect(422);
  });

  it('serves an image only while visible content references it and it is scanned clean', async () => {
    const res = await get(`/v1/store/catalog/images/${active.imageFileId}`).expect(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(res.body as Buffer, PNG)).toBe(0);

    const orphan = await file();
    await get(`/v1/store/catalog/images/${orphan.publicId}`).expect(404);
    const pending = await file('pending');
    await prisma.catalogProductImage.create({
      data: {
        catalogProductId: (await prisma.catalogProduct.findUniqueOrThrow({ where: { slug: active.slug } }))
          .id,
        fileObjectId: pending.id,
      },
    });
    await get(`/v1/store/catalog/images/${pending.publicId}`).expect(404);
  });

  it('shows banners only while published and inside their window', async () => {
    const desktop = await file();
    const title = `banner-${run}`;
    await prisma.banner.createMany({
      data: [
        { position: 'popup', title: `${title}-now`, desktopFileId: desktop.id, status: 'published' },
        {
          position: 'popup',
          title: `${title}-future`,
          desktopFileId: desktop.id,
          status: 'published',
          validFrom: new Date(Date.now() + 86_400_000),
        },
        { position: 'popup', title: `${title}-draft`, desktopFileId: desktop.id, status: 'draft' },
      ],
    });
    const res = await get('/v1/store/catalog/banners?position=popup').expect(200);
    const titles = (res.body as { title: string }[]).map((b) => b.title).filter((t) => t.startsWith(title));
    expect(titles).toEqual([`${title}-now`]);
  });

  it('publishes the Merchant feed from price summaries, with absolute links and no factory data', async () => {
    const res = await get('/v1/store/catalog/merchant-feed.xml').expect(200);
    expect(res.headers['content-type']).toMatch(/application\/xml/);
    const text = res.text;
    expect(text).toContain(`<g:id>${sku}</g:id>`);
    expect(text).toContain('<g:price>3.46 THB</g:price>');
    expect(text).toContain('<g:availability>in_stock</g:availability>');
    expect(text).toMatch(
      /<g:image_link>https?:\/\/[^<]+\/v1\/store\/catalog\/images\/[0-9a-f-]+<\/g:image_link>/,
    );
    expect(text).not.toMatch(/factory/i);
  });

  it('looks up postcodes and refuses malformed ones gracefully', async () => {
    await get('/v1/store/catalog/geo/postcodes/abc')
      .expect(200)
      .expect((r) => expect(r.body).toEqual([]));
    await get('/v1/store/catalog/geo/provinces/NOPE/districts').expect(404);
  });
});
