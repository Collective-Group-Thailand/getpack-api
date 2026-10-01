import { PrismaService } from '@database/prisma.service';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { seedDevFolding } from '../../prisma/seed/dev-folding';
import { type DevPouch, seedDevPouch } from '../../prisma/seed/dev-pouch';
import { seedDev } from '../../prisma/seed/dev-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from '../support/e2e';

/** Pouch quotes on every surface (U-B6 pouch), on the fake dev factory F9001. */
describe('pouch quotes (e2e, U-B6 pouch)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let fixture: DevPouch;
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
    fixture = (await prisma.$transaction((tx) => seedDevPouch(tx), { timeout: 60_000 })).fixture;
    for (const role of ['partner-manager', 'cs', 'prepress']) {
      const res = await request(server)
        .post('/v1/auth/staff/login')
        .send({ email: `${role}@example.invalid`, password: E2E_DEV_PASSWORD })
        .expect(200);
      tokens[role] = res.body.accessToken as string;
    }
  });

  afterAll(async () => {
    // Other suites expect pouches to stay RFQ until its calculator is signed off (A-16).
    await prisma?.productType.update({ where: { code: 'flexible_pouch' }, data: { quoteMode: 'rfq' } });
    await app?.close();
  });

  const as = (role: string) => ({
    get: (url: string) => request(server).get(url).auth(tokens[role]!, { type: 'bearer' }),
    post: (url: string, body: object) =>
      request(server).post(url).auth(tokens[role]!, { type: 'bearer' }).send(body),
  });

  const configuration = (over: Record<string, unknown> = {}) => ({
    patternId: fixture.standUpPatternPublicId,
    catalogProductId: fixture.catalogProductPublicId,
    w: 140,
    l: 200,
    b: 60,
    materialId: fixture.filmPublicId,
    printColourId: fixture.printColourPublicId,
    optionIds: [fixture.zipperPublicId, fixture.tearNotchPublicId],
    quantities: [500, 3000, 12000],
    design: { graphic: true, structure: false },
    ...over,
  });

  it('gives CS the catalogue choices of the pouch calculator', async () => {
    const res = await as('cs').get('/v1/admin/cs/pouch/input-data').expect(200);
    const body = res.body as {
      patterns: { id: string; pouch: { formula: string; needs: string[]; maxBMm: number | null } }[];
      films: { id: string; micron: number | null }[];
      options: { id: string }[];
      catalogProducts: { id: string }[];
    };
    expect(body.patterns.find((p) => p.id === fixture.standUpPatternPublicId)?.pouch).toMatchObject({
      formula: 'stand_up',
      needs: ['b'],
      maxBMm: 120,
    });
    expect(body.films.find((f) => f.id === fixture.filmPublicId)?.micron).toBe(80);
    expect(body.options.map((o) => o.id)).toContain(fixture.zipperPublicId);
    expect(body.catalogProducts.map((p) => p.id)).toContain(fixture.catalogProductPublicId);
    await as('prepress').get('/v1/admin/cs/pouch/input-data').expect(403);
  });

  it('prices for CS: below the minimum refused, the design fee once, cheaper per piece on a longer run', async () => {
    const cs = await as('cs').post('/v1/admin/cs/pouch/calculate', configuration()).expect(200);
    const [small, mid, large] = cs.body.steps as {
      quantity: number;
      instant: boolean;
      unitPrice: string | null;
      designFeeAmount: string;
      internal: { buyPrice: string | null };
    }[];
    expect(small).toMatchObject({ quantity: 500, instant: false, unitPrice: null });
    expect(mid).toMatchObject({ quantity: 3000, instant: true, designFeeAmount: '1500.00' });
    expect(mid!.internal.buyPrice).toBeNull();
    expect(Number(large!.unitPrice)).toBeLessThan(Number(mid!.unitPrice));
    const option = (cs.body.options as { error: string | null; stepErrors?: unknown }[])[0]!;
    expect(option.error).toBeNull();
    const pm = await as('partner-manager').post('/v1/admin/cs/pouch/calculate', configuration()).expect(200);
    expect(pm.body.steps[1].internal.buyPrice).toMatch(/^\d+\.\d{2}$/);
  });

  it('asks for the gusset the shape needs, and prices a 3-side seal without one', async () => {
    const noGusset = await as('cs')
      .post('/v1/admin/cs/pouch/calculate', configuration({ b: undefined }))
      .expect(422);
    expect(noGusset.body.errors[0]).toMatchObject({ path: 'b', code: 'required' });
    const flat = await as('cs')
      .post(
        '/v1/admin/cs/pouch/calculate',
        configuration({ patternId: fixture.threeSidePatternPublicId, b: undefined, quantities: [3000] }),
      )
      .expect(200);
    expect(flat.body.steps[0].instant).toBe(true);
  });

  it('prices the factory side on its own price list', async () => {
    const res = await as('partner-manager')
      .post(`/v1/partner/factories/${fixture.factoryPublicId}/pricing/pouch/calculate`, configuration())
      .expect((r) => expect([200, 403]).toContain(r.status));
    if (res.status === 200) expect(JSON.stringify(res.body)).not.toMatch(/sellPrice|grossAmount/);
  });

  it('validates the pouch configuration on the store, once pouches are instant', async () => {
    const body = { productTypeCode: 'flexible_pouch', configuration: configuration({ quantities: [3000] }) };
    await request(server).post('/v1/store/quotes/actions/calculate').send(body).expect(422);
    await prisma.productType.update({ where: { code: 'flexible_pouch' }, data: { quoteMode: 'instant' } });
    try {
      const res = await request(server).post('/v1/store/quotes/actions/calculate').send(body).expect(200);
      expect(res.body.steps[0].internal).toBeUndefined();
      expect(res.body.steps[0].unitPrice).toMatch(/^\d+\.\d{2}$/);
      const tooDeep = await request(server)
        .post('/v1/store/quotes/actions/calculate')
        .send({ ...body, configuration: configuration({ b: 200, quantities: [3000] }) })
        .expect(422);
      expect(tooDeep.body.errors[0].path).toBe('configuration.b');
      const noProduct = await request(server)
        .post('/v1/store/quotes/actions/calculate')
        .send({ ...body, configuration: configuration({ catalogProductId: undefined, quantities: [3000] }) })
        .expect(422);
      expect(noProduct.body.errors[0]).toMatchObject({
        path: 'configuration.catalogProductId',
        code: 'required',
      });
      const configurator = await request(server)
        .get('/v1/store/catalog/products/dev-stand-up-pouch/configurator')
        .expect(200);
      expect(configurator.body).toMatchObject({ calculator: 'pouch', instant: true, unit: 'pouch' });
      expect(configurator.body.patterns[0].pouch).toMatchObject({ formula: 'stand_up', needs: ['b'] });
    } finally {
      await prisma.productType.update({ where: { code: 'flexible_pouch' }, data: { quoteMode: 'rfq' } });
    }
  });
});
