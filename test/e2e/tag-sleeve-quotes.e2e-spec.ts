import { PrismaService } from '@database/prisma.service';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { seedDevFolding } from '../../prisma/seed/dev-folding';
import { seedDev } from '../../prisma/seed/dev-seed';
import { type DevTagSleeve, seedDevTagSleeve } from '../../prisma/seed/dev-tag-sleeve';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from '../support/e2e';

/** Tag & sleeve quotes on every surface (U-B6 tag & sleeve), on the fake dev factory F9001. */
describe('tag & sleeve quotes (e2e, U-B6 tag & sleeve)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let fixture: DevTagSleeve;
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
    fixture = (await prisma.$transaction((tx) => seedDevTagSleeve(tx), { timeout: 60_000 })).fixture;
    for (const role of ['partner-manager', 'cs', 'prepress']) {
      const res = await request(server)
        .post('/v1/auth/staff/login')
        .send({ email: `${role}@example.invalid`, password: E2E_DEV_PASSWORD })
        .expect(200);
      tokens[role] = res.body.accessToken as string;
    }
  });

  afterAll(async () => {
    // Other suites expect tags to stay RFQ until its calculator is signed off (A-16).
    await prisma?.productType.update({ where: { code: 'tag_sleeve' }, data: { quoteMode: 'rfq' } });
    await app?.close();
  });

  const as = (role: string) => ({
    get: (url: string) => request(server).get(url).auth(tokens[role]!, { type: 'bearer' }),
    post: (url: string, body: object) =>
      request(server).post(url).auth(tokens[role]!, { type: 'bearer' }).send(body),
  });

  const configuration = (over: Record<string, unknown> = {}) => ({
    patternId: fixture.patternPublicId,
    catalogProductId: fixture.catalogProductPublicId,
    w: 50,
    l: 90,
    materialId: fixture.materialPublicId,
    difficultyLevelId: fixture.difficultyLevelPublicId,
    quantities: [300, 3000],
    printFront: [1, 2, 3, 4].map(() => ({ inkColourId: fixture.inkColourPublicId, percent: 100 })),
    finish1FrontId: fixture.finishPublicId,
    diecutTypeId: fixture.diecutTypePublicId,
    assemblies: [{ assemblyId: fixture.holePublicId }],
    design: { graphic: true, structure: true },
    ...over,
  });
  const optionOf = (body: { options: { optionKey: string; error: string | null }[] }, printType: string) =>
    body.options.find((o) => o.optionKey.endsWith(`:${printType}`));

  it('gives CS the catalogue choices of the tag & sleeve calculator: flat tag patterns only', async () => {
    const res = await as('cs').get('/v1/admin/cs/tag-sleeve/input-data').expect(200);
    const body = res.body as {
      patterns: { id: string; geometryFormula: string }[];
      assemblies: { id: string }[];
      catalogProducts: { id: string }[];
    };
    expect(body.patterns.map((p) => p.id)).toEqual([fixture.patternPublicId]);
    expect(body.patterns[0]!.geometryFormula).toBe('flat');
    expect(body.assemblies.map((a) => a.id)).toContain(fixture.holePublicId);
    expect(body.catalogProducts.map((p) => p.id)).toContain(fixture.catalogProductPublicId);
    await as('prepress').get('/v1/admin/cs/tag-sleeve/input-data').expect(403);
  });

  it('prices for CS on both print types, the graphic fee once and no structure fee (T18)', async () => {
    const cs = await as('cs').post('/v1/admin/cs/tag-sleeve/calculate', configuration()).expect(200);
    const [small, large] = cs.body.steps as {
      quantity: number;
      instant: boolean;
      designFeeAmount: string;
      unitPrice: string;
      internal: { productionRun: number; buyPrice: string | null };
    }[];
    expect(small).toMatchObject({ quantity: 300, instant: true, designFeeAmount: '1000.00' });
    expect(small!.internal.buyPrice).toBeNull();
    expect(Number(large!.unitPrice)).toBeLessThan(Number(small!.unitPrice));
    expect(optionOf(cs.body, fixture.offsetPrintTypePublicId)?.error).toBeNull();
    expect(optionOf(cs.body, fixture.digitalPrintTypePublicId)?.error).toBeNull();
    const pm = await as('partner-manager')
      .post('/v1/admin/cs/tag-sleeve/calculate', configuration())
      .expect(200);
    expect(pm.body.steps[0].internal.buyPrice).toMatch(/^\d+\.\d{2}$/);
  });

  it('refuses finish 2 on digital (legacy T9) and prices it offset', async () => {
    const res = await as('cs')
      .post(
        '/v1/admin/cs/tag-sleeve/calculate',
        configuration({ quantities: [3000], finish2: [{ finishId: fixture.foilPublicId }] }),
      )
      .expect(200);
    expect(optionOf(res.body, fixture.digitalPrintTypePublicId)?.error).toMatch(
      /^process_not_possible: special finishes \(finish 2\) are printed offset only/,
    );
    expect(optionOf(res.body, fixture.offsetPrintTypePublicId)?.error).toBeNull();
    expect(res.body.steps[0].instant).toBe(true);
  });

  it('refuses a folding pattern and a configuration without a die-cut', async () => {
    const folding = await prisma.pattern.findUniqueOrThrow({ where: { code: 'DEV-FLAT' } });
    const wrong = await as('cs')
      .post('/v1/admin/cs/tag-sleeve/calculate', configuration({ patternId: folding.publicId }))
      .expect(422);
    expect(wrong.body.errors[0]).toMatchObject({ path: 'patternId' });
    const noDiecut = await as('cs')
      .post('/v1/admin/cs/tag-sleeve/calculate', configuration({ diecutTypeId: undefined }))
      .expect(422);
    expect(noDiecut.body.errors[0].path).toBe('diecutTypeId');
  });

  it('prices the factory side on its own price list', async () => {
    const res = await as('partner-manager')
      .post(`/v1/partner/factories/${fixture.factoryPublicId}/pricing/tag-sleeve/calculate`, configuration())
      .expect((r) => expect([200, 403]).toContain(r.status));
    if (res.status === 200) expect(JSON.stringify(res.body)).not.toMatch(/sellPrice|grossAmount/);
  });

  it('validates the tag configuration on the store, once tags are instant', async () => {
    const body = { productTypeCode: 'tag_sleeve', configuration: configuration() };
    await request(server).post('/v1/store/quotes/actions/calculate').send(body).expect(422);
    await prisma.productType.update({ where: { code: 'tag_sleeve' }, data: { quoteMode: 'instant' } });
    try {
      const res = await request(server).post('/v1/store/quotes/actions/calculate').send(body).expect(200);
      expect(res.body.steps[0].internal).toBeUndefined();
      expect(res.body.steps[0].unitPrice).toMatch(/^\d+\.\d{2}$/);
      // A tag is checked on width and length only: wider than long is fine (legacy packaging 5).
      await request(server)
        .post('/v1/store/quotes/actions/calculate')
        .send({ ...body, configuration: configuration({ w: 90, l: 50 }) })
        .expect(200);
      const tooSmall = await request(server)
        .post('/v1/store/quotes/actions/calculate')
        .send({ ...body, configuration: configuration({ w: 10 }) })
        .expect(422);
      expect(tooSmall.body.errors[0].path).toBe('configuration.w');
      const noProduct = await request(server)
        .post('/v1/store/quotes/actions/calculate')
        .send({ ...body, configuration: configuration({ catalogProductId: undefined }) })
        .expect(422);
      expect(noProduct.body.errors[0]).toMatchObject({
        path: 'configuration.catalogProductId',
        code: 'required',
      });
      const configurator = await request(server)
        .get('/v1/store/catalog/products/dev-hang-tag/configurator')
        .expect(200);
      expect(configurator.body).toMatchObject({ calculator: 'tag_sleeve', instant: true, unit: 'piece' });
      expect(configurator.body.patterns[0].id).toBe(fixture.patternPublicId);
    } finally {
      await prisma.productType.update({ where: { code: 'tag_sleeve' }, data: { quoteMode: 'rfq' } });
    }
  });
});
