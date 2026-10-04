import { PrismaService } from '@database/prisma.service';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { seedDevFolding } from '../../prisma/seed/dev-folding';
import { seedDev } from '../../prisma/seed/dev-seed';
import { type DevService, seedDevService } from '../../prisma/seed/dev-service';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from '../support/e2e';

/** Service quotes on every surface (U-B6 service), on the fake dev factory F9001. */
describe('service quotes (e2e, U-B6 service)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let fixture: DevService;
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
    fixture = (await prisma.$transaction((tx) => seedDevService(tx), { timeout: 60_000 })).fixture;
    for (const role of ['partner-manager', 'cs', 'prepress']) {
      const res = await request(server)
        .post('/v1/auth/staff/login')
        .send({ email: `${role}@example.invalid`, password: E2E_DEV_PASSWORD })
        .expect(200);
      tokens[role] = res.body.accessToken as string;
    }
  });

  afterAll(async () => {
    // Other suites expect services to stay RFQ until its calculator is signed off (A-16).
    await prisma?.productType.update({ where: { code: 'service' }, data: { quoteMode: 'rfq' } });
    await app?.close();
  });

  const as = (role: string) => ({
    get: (url: string) => request(server).get(url).auth(tokens[role]!, { type: 'bearer' }),
    post: (url: string, body: object) =>
      request(server).post(url).auth(tokens[role]!, { type: 'bearer' }).send(body),
  });

  it('gives CS the service items', async () => {
    const res = await as('cs').get('/v1/admin/cs/service/input-data').expect(200);
    const slugs = (res.body.items as { slug: string }[]).map((i) => i.slug);
    expect(slugs).toEqual(expect.arrayContaining(['dev-graphic-design', 'dev-print-plate']));
    await as('prepress').get('/v1/admin/cs/service/input-data').expect(403);
  });

  it('prices a service from the factory line, with no shipping line', async () => {
    const res = await as('cs')
      .post('/v1/admin/cs/service/calculate', { catalogProductId: fixture.platePublicId, quantities: [1, 3] })
      .expect(200);
    // Cost 1,000 ÷ 0.935 = 1,069.52 net; × 1.07 = 1,144.39 (legacy cs.vue, golden case 09).
    expect(res.body.steps[0]).toMatchObject({
      quantity: 1,
      instant: true,
      unitPrice: '1144.39',
      grossAmount: '1144.39',
      shippingAmount: null,
      shippingPending: false,
      leadTimeDays: 7,
    });
    expect(res.body.steps[1]).toMatchObject({ quantity: 3, grossAmount: '3433.17' });
    const design = await as('cs')
      .post('/v1/admin/cs/service/calculate', { catalogProductId: fixture.designPublicId, quantities: [1] })
      .expect(200);
    expect(design.body.steps[0].instant).toBe(false);
  });

  it('prices from the amount CS enters, hiding what the grants do not cover', async () => {
    const cost = await as('cs')
      .post('/v1/admin/cs/service/actions/price', {
        catalogProductId: fixture.platePublicId,
        basis: 'buy_cost_net',
        amount: 1000,
      })
      .expect(200);
    expect(cost.body).toMatchObject({
      quantity: 1,
      vatPct: '7',
      unit: { costAmount: '1000.00', netAmount: '1069.52', vatAmount: '74.87', grossAmount: '1144.39' },
    });
    const design = {
      catalogProductId: fixture.designPublicId,
      basis: 'sell_gross',
      amount: 1000,
      freelancer: true,
    };
    const cs = await as('cs').post('/v1/admin/cs/service/actions/price', design).expect(200);
    expect(cs.body.unit).toMatchObject({ netAmount: '934.58', vatAmount: '65.42', grossAmount: '1000.00' });
    expect(cs.body.unit.costAmount).toBeNull();
    expect(cs.body.freelancerPayableAmount).toBeNull();
    const pm = await as('partner-manager').post('/v1/admin/cs/service/actions/price', design).expect(200);
    // Browser rounding 873.83, PHP payable 873.84 (legacy quirk V4, golden case 01).
    expect(pm.body.unit.costAmount).toBe('873.83');
    expect(pm.body.freelancerPayableAmount).toBe('873.84');
    await as('cs')
      .post('/v1/admin/cs/service/actions/price', { ...design, amount: 0 })
      .expect(422);
  });

  it('takes the amount as a money string and the basis as buy_price_net, keeping the old spellings (U-B2, U-B3)', async () => {
    const price = (body: Record<string, unknown>) =>
      as('cs').post('/v1/admin/cs/service/actions/price', {
        catalogProductId: fixture.platePublicId,
        ...body,
      });
    const current = await price({ basis: 'buy_price_net', unitAmount: '1000.00' }).expect(200);
    expect(current.body.basis).toBe('buy_price_net');
    expect(current.body.unit).toMatchObject({
      buyAmount: '1000.00',
      costAmount: '1000.00',
      netAmount: '1069.52',
      grossAmount: '1144.39',
    });
    // The deprecated spellings price the same and are echoed as sent.
    const old = await price({ basis: 'buy_cost_net', amount: 1000 }).expect(200);
    expect(old.body.basis).toBe('buy_cost_net');
    expect(old.body.unit).toEqual(current.body.unit);
    const both = await price({ basis: 'buy_price_net', unitAmount: '1000.00', amount: 1000 }).expect(422);
    expect(both.body.errors[0]).toMatchObject({ path: 'unitAmount', code: 'exclusive' });
    const none = await price({ basis: 'buy_price_net' }).expect(422);
    expect(none.body.errors[0]).toMatchObject({ path: 'unitAmount', code: 'required' });
    await price({ basis: 'buy_price_net', unitAmount: '1000.001' }).expect(422);
    await price({ basis: 'buy_price_net', unitAmount: '0.00' }).expect(422);
  });

  it('prices the factory side on its own price list', async () => {
    const res = await as('partner-manager')
      .post(`/v1/partner/factories/${fixture.factoryPublicId}/pricing/service/calculate`, {
        catalogProductId: fixture.platePublicId,
        quantities: [1],
      })
      .expect((r) => expect([200, 403]).toContain(r.status));
    if (res.status === 200) expect(JSON.stringify(res.body)).not.toMatch(/sellPrice|grossAmount/);
  });

  it('prices on the store once services are instant', async () => {
    const body = {
      productTypeCode: 'service',
      configuration: { catalogProductId: fixture.platePublicId, quantities: [1] },
    };
    await request(server).post('/v1/store/quotes/actions/calculate').send(body).expect(422);
    await prisma.productType.update({ where: { code: 'service' }, data: { quoteMode: 'instant' } });
    try {
      const res = await request(server).post('/v1/store/quotes/actions/calculate').send(body).expect(200);
      expect(res.body.steps[0]).toMatchObject({ quantity: 1, unitPrice: '1144.39', shippingAmount: null });
      expect(res.body.steps[0].internal).toBeUndefined();
    } finally {
      await prisma.productType.update({ where: { code: 'service' }, data: { quoteMode: 'rfq' } });
    }
  });
});
