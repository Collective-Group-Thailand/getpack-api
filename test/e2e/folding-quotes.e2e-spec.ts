import { PrismaService } from '@database/prisma.service';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { type DevFolding, seedDevFolding } from '../../prisma/seed/dev-folding';
import { seedDev } from '../../prisma/seed/dev-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from '../support/e2e';

/** Folding quotes on every surface and Packio's sell margins (B2.3), on the fake dev factory F9001. */
describe('folding quotes (e2e, B2.3)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let fixture: DevFolding;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    await seedDev(prisma, E2E_DEV_PASSWORD);
    fixture = (await prisma.$transaction((tx) => seedDevFolding(tx), { timeout: 60_000 })).fixture;
    for (const role of ['superadmin', 'partner-manager', 'cs', 'prepress']) {
      const res = await request(server)
        .post('/v1/auth/staff/login')
        .send({ email: `${role}@example.invalid`, password: E2E_DEV_PASSWORD })
        .expect(200);
      tokens[role] = res.body.accessToken as string;
    }
  });

  afterAll(async () => {
    // Other suites expect folding to stay RFQ until its calculator ships (A-16).
    await prisma?.productType.update({ where: { code: 'folding_carton' }, data: { quoteMode: 'rfq' } });
    await app?.close();
  });

  const as = (role: string) => ({
    get: (url: string) => request(server).get(url).auth(tokens[role]!, { type: 'bearer' }),
    post: (url: string, body: object) =>
      request(server).post(url).auth(tokens[role]!, { type: 'bearer' }).send(body),
  });

  const configuration = () => ({
    patternId: fixture.patternPublicId,
    w: 200,
    l: 300,
    d: 50,
    materialId: fixture.materialPublicId,
    difficultyLevelId: fixture.difficultyLevelPublicId,
    quantities: [1000],
    parts: [
      {
        printFront: [1, 2, 3, 4].map(() => ({ inkColourId: fixture.inkColourPublicId, percent: 100 })),
        finish1FrontId: fixture.finishPublicId,
        diecutTypeId: fixture.diecutTypePublicId,
      },
    ],
    design: { graphic: true, structure: false },
  });

  it('gives CS the catalogue choices of the folding calculator', async () => {
    const res = await as('cs').get('/v1/admin/cs/folding/input-data').expect(200);
    const body = res.body as { patterns: { code: string }[]; finishes: { id: string; slot: string }[] };
    expect(body.patterns.map((p) => p.code)).toContain('DEV-FLAT');
    expect(body.finishes.find((f) => f.id === fixture.finishPublicId)).toMatchObject({
      slot: 'finish1',
    });
    await as('prepress').get('/v1/admin/cs/folding/input-data').expect(403);
  });

  it('prices a configuration for CS, hiding buy prices and margins from roles without D-141 grants', async () => {
    const cs = await as('cs').post('/v1/admin/cs/folding/calculate', configuration()).expect(200);
    const step = cs.body.steps[0];
    expect(step).toMatchObject({ quantity: 1000, instant: true, reason: null, shippingPending: true });
    expect(step.grossAmount).toMatch(/^\d+\.\d{2}$/);
    expect(step.designFeeAmount).toBe('2500.00');
    expect(step.toleranceShortagePct).toBe('5.0000');
    expect(step.earliestShipDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(step.internal).toMatchObject({
      factoryId: fixture.factoryPublicId,
      buyPrice: null,
      marginPct: null,
    });
    const pm = await as('partner-manager')
      .post('/v1/admin/cs/folding/calculate', configuration())
      .expect(200);
    expect(pm.body.steps[0].internal.buyPrice).toMatch(/^\d+\.\d{2}$/);
    expect(pm.body.steps[0].internal.marginPct).toMatch(/^-?\d+\.\d{4}$/);
    expect(Number(pm.body.steps[0].grossAmount)).toBe(Number(step.grossAmount));
  });

  it('validates the configuration against the catalogue', async () => {
    const bad = configuration();
    bad.parts[0]!.finish1FrontId = fixture.diecutTypePublicId;
    const res = await as('cs').post('/v1/admin/cs/folding/calculate', bad).expect(422);
    expect(res.body.code).toBe('validation.failed');
    await as('cs')
      .post('/v1/admin/cs/folding/calculate', { ...configuration(), quantities: [] })
      .expect(422);
  });

  it('prices for the store only once folding is quoted instantly, without any factory data (D-050)', async () => {
    const body = { productTypeCode: 'folding_carton', configuration: configuration() };
    const closed = await request(server).post('/v1/store/quotes/actions/calculate').send(body).expect(422);
    expect(closed.body.code).toBe('pricing.not_instant');
    await prisma.productType.update({ where: { code: 'folding_carton' }, data: { quoteMode: 'instant' } });
    const before = await prisma.calculateLog.count();
    const res = await request(server).post('/v1/store/quotes/actions/calculate').send(body).expect(200);
    expect(res.body.steps[0].instant).toBe(true);
    expect(res.body.steps[0]).not.toHaveProperty('internal');
    expect(JSON.stringify(res.body)).not.toContain(fixture.factoryPublicId);
    const log = await prisma.calculateLog.findFirstOrThrow({ orderBy: { id: 'desc' } });
    expect(await prisma.calculateLog.count()).toBe(before + 1);
    expect(log).toMatchObject({ channel: 'web', instantPath: true, routedToRfq: false, quantities: [1000] });
    await prisma.productType.update({ where: { code: 'folding_carton' }, data: { quoteMode: 'rfq' } });
  });

  it('lets a factory price on its own list only (D-044)', async () => {
    const email = `owner-f9001-${Date.now()}@factory.example`;
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
      .post(`/v1/partner/factories/${fixture.factoryPublicId}/pricing/folding/calculate`)
      .auth(token, { type: 'bearer' })
      .send(configuration())
      .expect(200);
    const option = res.body.options[0];
    expect(option).toMatchObject({ printTypeId: fixture.printTypePublicId, error: null });
    expect(option.steps[0].buyPrice).toMatch(/^\d+\.\d{2}$/);
    expect(JSON.stringify(res.body)).not.toMatch(/grossAmount|designFee|vat/i);
    const other = await prisma.factory.findFirst({ where: { code: { not: 'F9001' } } });
    if (other) {
      await request(server)
        .post(`/v1/partner/factories/${other.publicId}/pricing/folding/calculate`)
        .auth(token, { type: 'bearer' })
        .send(configuration())
        .expect(404);
    }
  });

  it('lets an admin switch folding to instant now that its calculator ships (D-100, A-16)', async () => {
    const type = await prisma.productType.findUniqueOrThrow({ where: { code: 'folding_carton' } });
    const change = async (quoteMode: 'instant' | 'rfq') => {
      const current = await as('superadmin')
        .get(`/v1/admin/catalog/product-types/${type.publicId}`)
        .expect(200);
      return request(server)
        .post(`/v1/admin/catalog/product-types/${type.publicId}/actions/change-quote-mode`)
        .auth(tokens['superadmin']!, { type: 'bearer' })
        .set('If-Match', current.headers['etag'] as string)
        .send({ quoteMode, reason: 'B2.3 folding calculator shipped (test)' });
    };
    const on = await change('instant');
    expect(on.status).toBe(200);
    expect(on.body.quoteMode).toBe('instant');
    expect((await change('rfq')).status).toBe(200);
  });

  it('keeps sell margins effective-dated and approved by Superadmin / C-Level (D-063)', async () => {
    const type = await prisma.productType.findUniqueOrThrow({ where: { code: 'folding_carton' } });
    await as('cs')
      .post('/v1/admin/sell-margin-tables', {
        productTypeId: type.publicId,
        printTypeId: null,
        kind: 'target_margin',
        description: 'x',
      })
      .expect(403);
    const table = await as('superadmin')
      .post('/v1/admin/sell-margin-tables', {
        productTypeId: type.publicId,
        printTypeId: fixture.printTypePublicId,
        kind: 'margin',
        description: 'Offset margins (fake)',
      })
      .expect(201);
    const line = (qtyMin: number | null, qtyMax: number | null, valuePct: string) => ({
      qtyMin,
      qtyMax,
      priceMin: null,
      priceMax: null,
      colourCount: null,
      difficultyLevelId: null,
      valuePct,
      valueAmount: null,
      minAmount: null,
    });
    const overlap = await as('superadmin')
      .post(`/v1/admin/sell-margin-tables/${table.body.id}/versions`, {
        effectiveFrom: new Date().toISOString(),
        reason: 'overlap',
        lines: [line(1, 1000, '30'), line(500, null, '20')],
      })
      .expect(422);
    expect(overlap.body.code).toBe('validation.failed');
    const draft = await as('superadmin')
      .post(`/v1/admin/sell-margin-tables/${table.body.id}/versions`, {
        effectiveFrom: '2026-01-01T00:00:00+07:00',
        reason: 'Offset tiers (fake)',
        fallbackPct: '28',
        lines: [line(1, 999, '32'), line(1000, null, '22')],
      })
      .expect(201);
    expect(draft.body).toMatchObject({ status: 'draft', versionNo: 1 });
    const approved = await as('superadmin')
      .post(`/v1/admin/sell-margin-tables/versions/${draft.body.id}/actions/approve`, {})
      .expect(200);
    expect(approved.body.status).toBe('approved');
    // A past effective date becomes the approval instant, never retroactive.
    expect(new Date(approved.body.effectiveFrom).getTime()).toBeGreaterThan(Date.now() - 60_000);
    await as('superadmin')
      .post(`/v1/admin/sell-margin-tables/versions/${draft.body.id}/actions/approve`, {})
      .expect(409);
    // The print type's own table now wins over the product type's (fixture 25 % → 22 %).
    const priced = await as('partner-manager')
      .post('/v1/admin/cs/folding/calculate', configuration())
      .expect(200);
    expect(priced.body.steps[0].instant).toBe(true);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'sell_margin_table.version_approved', resourcePublicId: table.body.id },
    });
    expect(audit).not.toBeNull();
  });
});
