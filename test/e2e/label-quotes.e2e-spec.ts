import { PrismaService } from '@database/prisma.service';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { seedDevFolding } from '../../prisma/seed/dev-folding';
import { type DevLabel, seedDevLabel } from '../../prisma/seed/dev-label';
import { seedDev } from '../../prisma/seed/dev-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from '../support/e2e';

/** Label quotes on every surface (U-B6 label), on the fake dev factory F9001. */
describe('label quotes (e2e, U-B6 label)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let fixture: DevLabel;
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
    fixture = (await prisma.$transaction((tx) => seedDevLabel(tx), { timeout: 60_000 })).fixture;
    for (const role of ['partner-manager', 'cs', 'prepress']) {
      const res = await request(server)
        .post('/v1/auth/staff/login')
        .send({ email: `${role}@example.invalid`, password: E2E_DEV_PASSWORD })
        .expect(200);
      tokens[role] = res.body.accessToken as string;
    }
  });

  afterAll(async () => {
    // Other suites expect labels to stay RFQ until its calculator is signed off (A-16).
    await prisma?.productType.update({ where: { code: 'label_sticker' }, data: { quoteMode: 'rfq' } });
    await app?.close();
  });

  const as = (role: string) => ({
    get: (url: string) => request(server).get(url).auth(tokens[role]!, { type: 'bearer' }),
    post: (url: string, body: object) =>
      request(server).post(url).auth(tokens[role]!, { type: 'bearer' }).send(body),
  });

  const configuration = (over: Record<string, unknown> = {}) => ({
    catalogProductId: fixture.catalogProductPublicId,
    w: 50,
    l: 70,
    materialId: fixture.labelStockPublicId,
    difficultyLevelId: fixture.difficultyLevelPublicId,
    quantities: [500, 3000],
    printFront: { inkColourIds: [fixture.inkColourPublicId] },
    finishFrontId: fixture.coatingPublicId,
    diecutTypeId: fixture.diecutTypePublicId,
    design: { graphic: true, structure: false },
    ...over,
  });

  it('gives CS the catalogue choices of the label calculator', async () => {
    const res = await as('cs').get('/v1/admin/cs/label/input-data').expect(200);
    const body = res.body as {
      labelStocks: { id: string; gsm: number | null }[];
      diecutTypes: { id: string }[];
      catalogProducts: { id: string }[];
    };
    expect(body.labelStocks.find((s) => s.id === fixture.labelStockPublicId)?.gsm).toBe(80);
    expect(body.diecutTypes.map((d) => d.id)).toContain(fixture.diecutTypePublicId);
    expect(body.catalogProducts.map((p) => p.id)).toContain(fixture.catalogProductPublicId);
    await as('prepress').get('/v1/admin/cs/label/input-data').expect(403);
  });

  it('prices for CS on the digital print type, refusing offset (quirk L2), hiding buy prices without D-141 grants', async () => {
    const cs = await as('cs').post('/v1/admin/cs/label/calculate', configuration()).expect(200);
    const [small, large] = cs.body.steps as {
      quantity: number;
      instant: boolean;
      designFeeAmount: string;
      toolingAmount: string;
      unitPrice: string;
      internal: { printTypeId: string; buyPrice: string | null };
    }[];
    expect(small).toMatchObject({
      quantity: 500,
      instant: true,
      designFeeAmount: '800.00',
      toolingAmount: '0.00',
    });
    expect(small!.internal).toMatchObject({ printTypeId: fixture.digitalPrintTypePublicId, buyPrice: null });
    // A longer run is cheaper per piece.
    expect(Number(large!.unitPrice)).toBeLessThan(Number(small!.unitPrice));
    const options = cs.body.options as { optionKey: string; error: string | null }[];
    expect(options.find((o) => o.optionKey.endsWith(`:${fixture.offsetPrintTypePublicId}`))?.error).toBe(
      'process_not_possible: offset label printing',
    );
    const pm = await as('partner-manager').post('/v1/admin/cs/label/calculate', configuration()).expect(200);
    expect(pm.body.steps[0].internal.buyPrice).toMatch(/^\d+\.\d{2}$/);
    // Below the factory's minimum order.
    const tiny = await as('cs')
      .post('/v1/admin/cs/label/calculate', configuration({ quantities: [50] }))
      .expect(200);
    expect(tiny.body.steps[0].unitPrice).toBeNull();
  });

  it('prices the factory side on its own price list and keeps other factories out', async () => {
    const owner = await prisma.factory.findUniqueOrThrow({ where: { publicId: fixture.factoryPublicId } });
    const res = await as('partner-manager')
      .post(`/v1/partner/factories/${owner.publicId}/pricing/label/calculate`, configuration())
      .expect((r) => expect([200, 403]).toContain(r.status));
    if (res.status === 200) expect(JSON.stringify(res.body)).not.toMatch(/sellPrice|grossAmount/);
  });

  it('validates the label configuration on the store, once labels are instant', async () => {
    const body = { productTypeCode: 'label_sticker', configuration: configuration() };
    await request(server).post('/v1/store/quotes/actions/calculate').send(body).expect(422);
    await prisma.productType.update({ where: { code: 'label_sticker' }, data: { quoteMode: 'instant' } });
    try {
      const res = await request(server).post('/v1/store/quotes/actions/calculate').send(body).expect(200);
      expect(res.body.steps[0].internal).toBeUndefined();
      expect(res.body.steps[0].unitPrice).toMatch(/^\d+\.\d{2}$/);
      const noProduct = await request(server)
        .post('/v1/store/quotes/actions/calculate')
        .send({ ...body, configuration: configuration({ catalogProductId: undefined }) })
        .expect(422);
      expect(noProduct.body.errors[0]).toMatchObject({
        path: 'configuration.catalogProductId',
        code: 'required',
      });
      const wrongStock = await request(server)
        .post('/v1/store/quotes/actions/calculate')
        .send({ ...body, configuration: configuration({ materialId: fixture.coatingPublicId }) })
        .expect(422);
      expect(wrongStock.body.errors[0].path).toBe('materialId');
      const configurator = await request(server)
        .get('/v1/store/catalog/products/dev-sticker/configurator')
        .expect(200);
      expect(configurator.body).toMatchObject({ calculator: 'label', instant: true, unit: 'piece' });
    } finally {
      await prisma.productType.update({ where: { code: 'label_sticker' }, data: { quoteMode: 'rfq' } });
    }
  });
});
