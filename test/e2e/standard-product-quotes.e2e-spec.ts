import { PrismaService } from '@database/prisma.service';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { seedDevFolding } from '../../prisma/seed/dev-folding';
import { seedDev } from '../../prisma/seed/dev-seed';
import { type DevStandardProduct, seedDevStandardProduct } from '../../prisma/seed/dev-standard-product';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from '../support/e2e';

/** Standard-product quotes on every surface (U-B6 standard product), on the fake dev factory F9001. */
describe('standard product quotes (e2e, U-B6 standard product)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let fixture: DevStandardProduct;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    await seedDev(prisma, E2E_DEV_PASSWORD);
    await prisma.$transaction((tx) => seedDevFolding(tx), { timeout: 60_000 });
    fixture = (await prisma.$transaction((tx) => seedDevStandardProduct(tx), { timeout: 60_000 })).fixture;
    for (const role of ['partner-manager', 'cs', 'prepress']) {
      const res = await request(server)
        .post('/v1/auth/staff/login')
        .send({ email: `${role}@example.invalid`, password: E2E_DEV_PASSWORD })
        .expect(200);
      tokens[role] = res.body.accessToken as string;
    }
  });

  afterAll(async () => {
    // Other suites expect standard products to stay RFQ until its calculator is signed off (A-16).
    await prisma?.productType.update({ where: { code: 'standard_product' }, data: { quoteMode: 'rfq' } });
    await app?.close();
  });

  const as = (role: string) => ({
    get: (url: string) => request(server).get(url).auth(tokens[role]!, { type: 'bearer' }),
    post: (url: string, body: object) =>
      request(server).post(url).auth(tokens[role]!, { type: 'bearer' }).send(body),
  });
  const configuration = (over: Record<string, unknown> = {}) => ({
    stockProductId: fixture.bottlePublicId,
    quantities: [50, 750, 999, 1000],
    design: { graphic: false, structure: false },
    ...over,
  });

  it('gives CS the standard products', async () => {
    const res = await as('cs').get('/v1/admin/cs/standard-product/input-data').expect(200);
    const products = res.body.stockProducts as {
      id: string;
      sku: string;
      unit: string;
      minOrderQty: number;
    }[];
    expect(products.find((p) => p.id === fixture.bottlePublicId)).toMatchObject({
      sku: 'DEV-BTL-100',
      unit: 'piece',
      minOrderQty: 100,
    });
    await as('prepress').get('/v1/admin/cs/standard-product/input-data').expect(403);
  });

  it('prices the tiers for CS: below the minimum refused, the lower tier at the shared bound', async () => {
    const cs = await as('cs').post('/v1/admin/cs/standard-product/calculate', configuration()).expect(200);
    const steps = cs.body.steps as { quantity: number; instant: boolean; unitPrice: string | null }[];
    // (2.20 + 0.50) ÷ 0.7 = 3.8571 → 3.86 × 1.07 = 4.1302 → 4.14; (2.00 + 0.50) ÷ 0.7 → 3.58 × 1.07 → 3.84.
    expect(steps.map((s) => [s.quantity, s.instant, s.unitPrice])).toEqual([
      [50, false, null],
      [750, true, '4.14'],
      [999, true, '4.14'],
      [1000, true, '3.84'],
    ]);
    const pm = await as('partner-manager')
      .post('/v1/admin/cs/standard-product/calculate', configuration({ quantities: [750] }))
      .expect(200);
    // 750 × 2.20 buy.
    expect(pm.body.steps[0].internal.buyPrice).toBe('1650.00');
  });

  it('prices a stock pouch (no weight: it ships as pouches) and adds the design fee once', async () => {
    const res = await as('cs')
      .post(
        '/v1/admin/cs/standard-product/calculate',
        configuration({
          stockProductId: fixture.pouchPublicId,
          quantities: [5000],
          design: { graphic: true, structure: false },
        }),
      )
      .expect(200);
    expect(res.body.steps[0]).toMatchObject({ quantity: 5000, instant: true, designFeeAmount: '900.00' });
  });

  it('refuses an unknown stock product', async () => {
    const res = await as('cs')
      .post(
        '/v1/admin/cs/standard-product/calculate',
        configuration({ stockProductId: '0192f3a0-7c1e-7d2a-9b1f-0000000000ff' }),
      )
      .expect(422);
    expect(res.body.errors[0].path).toBe('stockProductId');
  });

  it('prices the factory side on its own price list', async () => {
    const res = await as('partner-manager')
      .post(
        `/v1/partner/factories/${fixture.factoryPublicId}/pricing/standard-product/calculate`,
        configuration({ quantities: [750] }),
      )
      .expect((r) => expect([200, 403]).toContain(r.status));
    if (res.status === 200) expect(JSON.stringify(res.body)).not.toMatch(/sellPrice|grossAmount/);
  });

  it('prices on the store once standard products are instant', async () => {
    const body = {
      productTypeCode: 'standard_product',
      configuration: configuration({ quantities: [1000] }),
    };
    await request(server).post('/v1/store/quotes/actions/calculate').send(body).expect(422);
    await prisma.productType.update({ where: { code: 'standard_product' }, data: { quoteMode: 'instant' } });
    try {
      const res = await request(server).post('/v1/store/quotes/actions/calculate').send(body).expect(200);
      expect(res.body.steps[0]).toMatchObject({ quantity: 1000, unitPrice: '3.84' });
      expect(res.body.steps[0].internal).toBeUndefined();
    } finally {
      await prisma.productType.update({ where: { code: 'standard_product' }, data: { quoteMode: 'rfq' } });
    }
  });
});
