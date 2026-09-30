import { PrismaService } from '@database/prisma.service';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { type DevCorrugate, seedDevCorrugate } from '../../prisma/seed/dev-corrugate';
import { seedDevFolding } from '../../prisma/seed/dev-folding';
import { seedDev } from '../../prisma/seed/dev-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from '../support/e2e';

/** Corrugate quotes on every surface (U-B6), on the fake dev factory F9001. */
describe('corrugate quotes (e2e, U-B6)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let fixture: DevCorrugate;
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
    fixture = (await prisma.$transaction((tx) => seedDevCorrugate(tx), { timeout: 60_000 })).fixture;
    for (const role of ['partner-manager', 'cs', 'prepress', 'admin']) {
      const res = await request(server)
        .post('/v1/auth/staff/login')
        .send({ email: `${role}@example.invalid`, password: E2E_DEV_PASSWORD })
        .expect(200);
      tokens[role] = res.body.accessToken as string;
    }
  });

  afterAll(async () => {
    // Other suites expect corrugate to stay RFQ until its calculator ships (A-16).
    await prisma?.productType.update({ where: { code: 'corrugated' }, data: { quoteMode: 'rfq' } });
    await app?.close();
  });

  const as = (role: string) => ({
    get: (url: string) => request(server).get(url).auth(tokens[role]!, { type: 'bearer' }),
    post: (url: string, body: object) =>
      request(server).post(url).auth(tokens[role]!, { type: 'bearer' }).send(body),
  });

  const configuration = (over: Record<string, unknown> = {}) => ({
    patternId: fixture.rscPatternPublicId,
    catalogProductId: fixture.catalogProductPublicId,
    w: 300,
    l: 400,
    d: 250,
    materialId: fixture.boardPublicId,
    difficultyLevelId: fixture.difficultyLevelPublicId,
    quantities: [1000],
    parts: [{ printFront: [{ inkColourId: fixture.inkColourPublicId, area: 'top' }] }],
    design: { graphic: true, structure: false },
    ...over,
  });

  it('gives CS the catalogue choices of the corrugate calculator, without the automatic packing', async () => {
    const res = await as('cs').get('/v1/admin/cs/corrugate/input-data').expect(200);
    const body = res.body as {
      patterns: {
        code: string;
        corrugateFormula: string | null;
        subPatterns: { corrugateFormula: string }[];
      }[];
      boards: { id: string; coatable: boolean; flute: { code: string } }[];
      assemblies: { id: string }[];
      printAreas: string[];
    };
    expect(body.patterns.find((p) => p.code === 'DEV-RSC')?.corrugateFormula).toBe('rsc');
    expect(
      body.patterns.find((p) => p.code === 'DEV-TELE')?.subPatterns.map((s) => s.corrugateFormula),
    ).toEqual(['tele_body', 'tele_lid']);
    expect(body.boards.find((b) => b.id === fixture.boardPublicId)).toMatchObject({
      coatable: true,
      flute: { code: 'DEV-B' },
    });
    expect(body.assemblies.map((a) => a.id)).not.toContain(fixture.packingAssemblyPublicId);
    expect(body.printAreas).toEqual(['top', 'side', 'top_side', 'all_round']);
    await as('prepress').get('/v1/admin/cs/corrugate/input-data').expect(403);
  });

  it('prices for CS with plates as their own line, hiding buy prices and margins without D-141 grants', async () => {
    const cs = await as('cs').post('/v1/admin/cs/corrugate/calculate', configuration()).expect(200);
    const step = cs.body.steps[0];
    expect(step).toMatchObject({ quantity: 1000, instant: true, reason: null, designFeeAmount: '2000.00' });
    expect(Number(step.toolingAmount)).toBeGreaterThan(0);
    expect(step.internal).toMatchObject({
      factoryId: fixture.factoryPublicId,
      buyPrice: null,
      marginPct: null,
    });
    expect(cs.body.options).toHaveLength(2);
    const pm = await as('partner-manager')
      .post('/v1/admin/cs/corrugate/calculate', configuration())
      .expect(200);
    expect(pm.body.steps[0].internal.buyPrice).toMatch(/^\d+\.\d{2}$/);
    expect(Number(pm.body.steps[0].grossAmount)).toBe(Number(step.grossAmount));
  });

  it('refuses a coating on flexo and prices it on digital (quirk C5), with the option reason for CS', async () => {
    const res = await as('partner-manager')
      .post(
        '/v1/admin/cs/corrugate/calculate',
        configuration({
          parts: [
            {
              printFront: [{ inkColourId: fixture.inkColourPublicId, area: 'top' }],
              coatingFrontId: fixture.coatingPublicId,
            },
          ],
        }),
      )
      .expect(200);
    const reasons = (res.body.options as { optionKey: string; error: string | null }[]).map((o) => o.error);
    expect(reasons).toContain('process_not_possible: main: flexo prints no coating');
    expect(res.body.steps[0].internal.printTypeId).toBe(fixture.digitalPrintTypePublicId);
    expect(res.body.steps[0].toolingAmount).toBe('0.00');
  });

  it('validates the configuration of the type’s calculator on the store, once corrugate is instant', async () => {
    const body = { productTypeCode: 'corrugated', configuration: configuration() };
    await request(server).post('/v1/store/quotes/actions/calculate').send(body).expect(422);
    await prisma.productType.update({ where: { code: 'corrugated' }, data: { quoteMode: 'instant' } });
    const res = await request(server).post('/v1/store/quotes/actions/calculate').send(body).expect(200);
    expect(res.body.steps[0].internal).toBeUndefined();
    expect(res.body.steps[0].toolingAmount).toMatch(/^\d+\.\d{2}$/);
    const unknown = await request(server)
      .post('/v1/store/quotes/actions/calculate')
      .send({ ...body, configuration: { ...configuration(), digitalFrontCoveragePct: 60 } })
      .expect(422);
    expect(unknown.body.errors[0].path).toBe('configuration.digitalFrontCoveragePct');
    const noArea = await request(server)
      .post('/v1/store/quotes/actions/calculate')
      .send({
        ...body,
        configuration: configuration({
          parts: [{ printFront: [{ inkColourId: fixture.inkColourPublicId }] }],
        }),
      })
      .expect(422);
    expect(noArea.body.errors[0].path).toBe('parts[0].printFront[0]');
    const noProduct = await request(server)
      .post('/v1/store/quotes/actions/calculate')
      .send({ ...body, configuration: configuration({ catalogProductId: undefined }) })
      .expect(422);
    expect(noProduct.body.errors[0]).toMatchObject({
      path: 'configuration.catalogProductId',
      code: 'required',
    });
    await prisma.productType.update({ where: { code: 'corrugated' }, data: { quoteMode: 'rfq' } });
  });

  it('publishes the configurator of a calculator-priced product, with the ids the configuration takes', async () => {
    const res = await request(server)
      .get('/v1/store/catalog/products/dev-rsc-carton/configurator')
      .expect(200);
    expect(res.body).toMatchObject({
      catalogProductId: fixture.catalogProductPublicId,
      productTypeCode: 'corrugated',
      calculator: 'corrugate',
      instant: false, // corrugate is still RFQ
      difficultyLevelId: fixture.difficultyLevelPublicId,
      printAreas: ['top', 'side', 'top_side', 'all_round'],
    });
    expect(res.body.quoteValidityDays).toBeGreaterThan(0);
    const [pattern] = res.body.patterns as {
      id: string;
      rules: Record<string, unknown>;
      fluteTypeIds: string[];
    }[];
    expect(pattern).toMatchObject({
      id: fixture.rscPatternPublicId,
      fluteTypeIds: [fixture.fluteTypePublicId],
    });
    expect(pattern!.rules).toMatchObject({ minWMm: 100, maxHMm: 800, widthMustExceedHeight: true });
    const material = (
      res.body.optionGroups as { kind: string; options: { id: string; attributes: object }[] }[]
    ).find((g) => g.kind === 'material')!;
    expect(material.options[0]).toMatchObject({ id: fixture.boardPublicId, attributes: { coatable: true } });
    expect(JSON.stringify(res.body)).not.toMatch(/factory|buyPrice|margin/i);
    // A folding product without a difficulty level is not priced online; a type without a calculator is not found.
    const folding = await request(server)
      .get('/v1/store/catalog/products/dev-tuck-end-box/configurator')
      .expect(200);
    expect(folding.body).toMatchObject({
      calculator: 'folding',
      instant: false,
      difficultyLevelId: null,
      printAreas: [],
    });
    await request(server).get('/v1/store/catalog/products/no-such-product/configurator').expect(404);
  });

  it('prices a store request at the catalogue product’s own difficulty only (quirk C9)', async () => {
    await prisma.productType.update({ where: { code: 'corrugated' }, data: { quoteMode: 'instant' } });
    try {
      const other = await prisma.difficultyLevel.upsert({
        where: { code: 'dev-e2e-easy' },
        create: { code: 'dev-e2e-easy', nameTh: 'ง่าย (ทดสอบ)', nameEn: 'Easy (fake)', status: 'active' },
        update: {},
      });
      const cheaper = configuration({ difficultyLevelId: other.publicId });
      const res = await request(server)
        .post('/v1/store/quotes/actions/calculate')
        .send({ productTypeCode: 'corrugated', configuration: cheaper })
        .expect(422);
      expect(res.body.errors[0]).toMatchObject({ path: 'configuration.difficultyLevelId', code: 'in' });
      // CS chooses the level (legacy CS difficulty groups).
      await as('cs').post('/v1/admin/cs/corrugate/calculate', cheaper).expect(200);
    } finally {
      await prisma.productType.update({ where: { code: 'corrugated' }, data: { quoteMode: 'rfq' } });
    }
  });

  it('checks the pattern size rules on the store, not for CS (legacy validateInput)', async () => {
    await prisma.productType.update({ where: { code: 'corrugated' }, data: { quoteMode: 'instant' } });
    try {
      // 0.95 × 300 = 285 < 286.
      const tooTall = configuration({ d: 286 });
      const res = await request(server)
        .post('/v1/store/quotes/actions/calculate')
        .send({ productTypeCode: 'corrugated', configuration: tooTall })
        .expect(422);
      expect(res.body.errors[0]).toMatchObject({ path: 'configuration.d', code: 'size' });
      await as('cs').post('/v1/admin/cs/corrugate/calculate', tooTall).expect(200);
      const configurator = await request(server)
        .get('/v1/store/catalog/products/dev-rsc-carton/configurator')
        .expect(200);
      expect(configurator.body.instant).toBe(true);
    } finally {
      await prisma.productType.update({ where: { code: 'corrugated' }, data: { quoteMode: 'rfq' } });
    }
  });

  it('lets the admin switch corrugate to instant now that its calculator has shipped, and back (D-100)', async () => {
    const type = await prisma.productType.findUniqueOrThrow({ where: { code: 'corrugated' } });
    const url = `/v1/admin/catalog/product-types/${type.publicId}`;
    const read = await as('admin').get(url).expect(200);
    expect(read.body.quoteMode).toBe('rfq'); // seeded RFQ until sign-off (A-16)
    const instant = await as('admin')
      .post(`${url}/actions/change-quote-mode`, { quoteMode: 'instant', reason: 'Pricing sign-off received' })
      .set('If-Match', read.headers['etag'] as string)
      .expect(200);
    expect(instant.body.quoteMode).toBe('instant');
    try {
      const configurator = await request(server)
        .get('/v1/store/catalog/products/dev-rsc-carton/configurator')
        .expect(200);
      expect(configurator.body.instant).toBe(true);
      await request(server)
        .post('/v1/store/quotes/actions/calculate')
        .send({ productTypeCode: 'corrugated', configuration: configuration() })
        .expect(200);
    } finally {
      await as('admin')
        .post(`${url}/actions/change-quote-mode`, {
          quoteMode: 'rfq',
          reason: 'Back to RFQ for the other suites',
        })
        .set('If-Match', instant.headers['etag'] as string)
        .expect(200);
    }
  });

  it('lets CS save a corrugate quotation, priced on the server (D-051)', async () => {
    const res = await as('cs')
      .post('/v1/admin/quotes', { productTypeCode: 'corrugated', configuration: configuration() })
      .expect(201);
    expect(res.body).toMatchObject({ productTypeCode: 'corrugated', source: 'instant' });
    expect(res.body.configuration.patternId).toBe(fixture.rscPatternPublicId);
  });

  it('lets a factory price on its own list only (D-044)', async () => {
    const email = `owner-corrugate-${Date.now()}@factory.example`;
    await as('partner-manager')
      .post(`/v1/admin/factories/${fixture.factoryPublicId}/owner-account`, {
        email,
        displayName: 'เจ้าของ ทดสอบ',
        initialPassword: E2E_DEV_PASSWORD,
      })
      .expect(201);
    const login = await request(server)
      .post('/v1/auth/partner/login')
      .send({ email, password: E2E_DEV_PASSWORD })
      .expect(200);
    const token = login.body.accessToken as string;
    const res = await request(server)
      .post(`/v1/partner/factories/${fixture.factoryPublicId}/pricing/corrugate/calculate`)
      .auth(token, { type: 'bearer' })
      .send(configuration())
      .expect(200);
    const options = res.body.options as { printTypeId: string }[];
    expect(options.map((o) => o.printTypeId).sort()).toEqual(
      [fixture.flexoPrintTypePublicId, fixture.digitalPrintTypePublicId].sort(),
    );
    expect(JSON.stringify(res.body)).not.toMatch(/grossAmount|designFee|vat/i);
    const other = await prisma.factory.findFirst({ where: { code: { not: 'F9001' } } });
    if (other) {
      await request(server)
        .post(`/v1/partner/factories/${other.publicId}/pricing/corrugate/calculate`)
        .auth(token, { type: 'bearer' })
        .send(configuration())
        .expect(404);
    }
  });
});
