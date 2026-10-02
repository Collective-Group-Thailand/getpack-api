import { PrismaService } from '@database/prisma.service';
import { ENGINE_B_FLAG } from '@modules/pricing/calculators/folding/folding.adapter';
import { QuoteEngineService } from '@modules/pricing/quotes/quote-engine.service';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FeatureFlagsService } from '@platform/feature-flags/feature-flags.service';
import request from 'supertest';

import { type DevFolding, seedDevFolding } from '../../prisma/seed/dev-folding';
import { type DevFoldingB, seedDevFoldingB } from '../../prisma/seed/dev-folding-b';
import { seedDev } from '../../prisma/seed/dev-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from '../support/e2e';

/**
 * Folding engine B behind its release flag (U-B6 tail, D-233), on the fake type-B factory F9002 next to the tier-A
 * launch factory F9001: customer and CS quotes refuse B until `pricing.folding_engine_b` is on; the factory breakdown
 * prices B meanwhile; with the flag on B competes on buy price like any option.
 */
describe('folding engine B quotes (e2e, U-B6 tail)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let engine: QuoteEngineService;
  let flags: FeatureFlagsService;
  let a: DevFolding;
  let b: DevFoldingB;
  const tokens: Record<string, string> = {};

  const setFlag = async (enabled: boolean) => {
    await prisma.featureFlag.update({ where: { key: ENGINE_B_FLAG }, data: { enabled } });
    flags.invalidate();
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    engine = app.get(QuoteEngineService);
    flags = app.get(FeatureFlagsService);
    await seedDev(prisma, E2E_DEV_PASSWORD);
    a = (await prisma.$transaction((tx) => seedDevFolding(tx), { timeout: 60_000 })).fixture;
    b = (await prisma.$transaction((tx) => seedDevFoldingB(tx), { timeout: 60_000 })).fixture;
    await prisma.factory.update({ where: { code: 'F9002' }, data: { status: 'active' } });
    await setFlag(false);
    for (const role of ['cs', 'partner-manager']) {
      const res = await request(server)
        .post('/v1/auth/staff/login')
        .send({ email: `${role}@example.invalid`, password: E2E_DEV_PASSWORD })
        .expect(200);
      tokens[role] = res.body.accessToken as string;
    }
  });

  afterAll(async () => {
    // Other folding suites price the launch factory alone and expect engine B off.
    await prisma?.factory.update({ where: { code: 'F9002' }, data: { status: 'suspended' } });
    if (flags) await setFlag(false);
    await app?.close();
  });

  const configuration = () => ({
    patternId: a.patternPublicId,
    w: 200,
    l: 300,
    d: 50,
    materialId: a.materialPublicId,
    difficultyLevelId: a.difficultyLevelPublicId,
    quantities: [1000],
    parts: [
      {
        printFront: [1, 2, 3, 4].map(() => ({ inkColourId: a.inkColourPublicId, percent: 100 })),
        finish1FrontId: a.finishPublicId,
        diecutTypeId: a.diecutTypePublicId,
      },
    ],
    design: { graphic: false, structure: false },
  });
  const bOption = () => `${b.factoryPublicId}:${b.printTypePublicId}`;
  const factoryB = () => prisma.factory.findUniqueOrThrow({ where: { code: 'F9002' } });

  it('holds engine B out of CS and customer quotes while the flag is off', async () => {
    const view = await engine.price('folding', configuration(), { channel: 'cs', log: false });
    const held = view.options.find((o) => o.optionKey === bOption());
    expect(held?.error).toMatch(/^process_not_possible: engine B awaits sign-off/);
    expect(view.steps[0]).toMatchObject({ instant: true });
    const cs = await request(server)
      .post('/v1/admin/cs/folding/calculate')
      .auth(tokens['cs']!, { type: 'bearer' })
      .send(configuration())
      .expect(200);
    expect(cs.body.steps[0].internal.factoryId).toBe(a.factoryPublicId);
  });

  it('prices engine B on the factory breakdown before the release, on its own lines only', async () => {
    const factory = await factoryB();
    const preview = await engine.priceForFactory('folding', configuration(), factory, new Date(), {
      preview: true,
    });
    const option = preview.options.find((o) => o.printTypeId === b.printTypePublicId)!;
    expect(option.error).toBeNull();
    expect(option.steps[0]!.buyPrice).toMatch(/^\d+\.\d{2}$/);
    expect(option.steps[0]!.productionRun).toBe(1000);
    const held = await engine.priceForFactory('folding', configuration(), factory);
    expect(held.options[0]!.error).toMatch(/^process_not_possible/);
    const res = await request(server)
      .post(`/v1/partner/factories/${b.factoryPublicId}/pricing/folding/calculate`)
      .auth(tokens['partner-manager']!, { type: 'bearer' })
      .send(configuration())
      .expect((r) => expect([200, 403]).toContain(r.status));
    if (res.status === 200) {
      expect(res.body.options[0].error).toBeNull();
      expect(JSON.stringify(res.body)).not.toMatch(/sellPrice|grossAmount/);
    }
  });

  it('lets engine B compete on buy price once the flag is on', async () => {
    await setFlag(true);
    try {
      const view = await engine.price('folding', configuration(), { channel: 'cs', log: false });
      expect(view.options.find((o) => o.optionKey === bOption())?.error).toBeNull();
      expect(view.steps[0]).toMatchObject({ instant: true });
      const preview = await engine.priceForFactory('folding', configuration(), await factoryB());
      expect(preview.options[0]!.error).toBeNull();
    } finally {
      await setFlag(false);
    }
  });
});
