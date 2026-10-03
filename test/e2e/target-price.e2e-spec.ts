import { randomUUID } from 'node:crypto';

import { bangkokDate } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type FakeSmsSender } from '@integrations/sms/fake-sms-sender';
import { SMS_SENDER } from '@integrations/sms/sms-sender.port';
import { ProspectusService } from '@modules/analytics/prospectus.service';
import { QuoteOutcomesService } from '@modules/quotes/levers/quote-outcomes.service';
import { SavedQuotesService } from '@modules/quotes/saved-quotes.service';
import { UnmetDemandSubscriber } from '@modules/rfq/unmet-demand.subscriber';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { envelopeFromRow } from '@platform/domain-events/domain-event';
import request from 'supertest';

import { type DevFolding, seedDevFolding } from '../../prisma/seed/dev-folding';
import { seedDev } from '../../prisma/seed/dev-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from '../support/e2e';

interface Quote {
  id: string;
  status: string;
  targetPricePerUnit: string | null;
  options: {
    quantity: number;
    unitPrice: string;
    targetGap: { gapPerUnit: string; meetsTarget: boolean } | null;
  }[];
  outcome: { outcome: string; lossReasonCode: string | null; leverTakenId: string | null } | null;
  fromLever: { leverId: string; quoteId: string } | null;
}
interface Levers {
  status: string;
  computedAt: string | null;
  levers: {
    id: string;
    kind: string;
    bestSavingPct: string;
    reasonCodes: string[];
    steps: { gapPerUnit: string }[];
  }[];
}

/** Target price, levers, quotation outcomes and price-gap unmet demand (U2.3, D-247–D-252, D-190). */
describe('target price and levers (e2e, U2.3)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let fixture: DevFolding;
  const tokens: Record<string, string> = {};
  const run = (Date.now() % 1_000_000) + 700_000;
  const anonymousId = `0192f3a0-7c1e-7d2a-9b1f-${String(run).padStart(12, '0')}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    await seedDev(prisma, E2E_DEV_PASSWORD);
    fixture = (await prisma.$transaction((tx) => seedDevFolding(tx), { timeout: 60_000 })).fixture;
    await prisma.productType.update({ where: { code: 'folding_carton' }, data: { quoteMode: 'instant' } });
    for (const role of ['cs', 'partner-manager', 'marketing']) {
      const res = await request(server)
        .post('/v1/auth/staff/login')
        .send({ email: `${role}@example.invalid`, password: E2E_DEV_PASSWORD })
        .expect(200);
      tokens[role] = res.body.accessToken as string;
    }
    const phone = `08${String(run).padStart(8, '0').slice(-8)}`;
    const requested = await request(server).post('/v1/auth/customer/otp/request').send({ phone }).expect(200);
    const code = /\b(\d{6})\b/.exec(
      app.get<FakeSmsSender>(SMS_SENDER).lastTo(`+66${phone.slice(1)}`)!.text,
    )![1]!;
    tokens['customer'] = (
      await request(server)
        .post('/v1/auth/customer/otp/verify')
        .send({ challengeId: requested.body.challengeId, code })
        .expect(200)
    ).body.accessToken as string;
    const email = `tp-owner-${run}@factory.example`;
    await as('partner-manager')
      .post(`/v1/admin/factories/${fixture.factoryPublicId}/owner-account`, {
        email,
        displayName: 'เจ้าของ',
        initialPassword: E2E_DEV_PASSWORD,
      })
      .expect(201);
    tokens['owner'] = (
      await request(server)
        .post('/v1/auth/partner/login')
        .send({ email, password: E2E_DEV_PASSWORD })
        .expect(200)
    ).body.accessToken as string;
  });

  afterAll(async () => {
    await prisma?.productType.update({ where: { code: 'folding_carton' }, data: { quoteMode: 'rfq' } });
    await app?.close();
  });

  const as = (role: string) => ({
    get: (url: string) => request(server).get(url).auth(tokens[role]!, { type: 'bearer' }),
    post: (url: string, body: object = {}) =>
      request(server)
        .post(url)
        .auth(tokens[role]!, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send(body),
  });

  const configuration = () => ({
    patternId: fixture.patternPublicId,
    w: 200,
    l: 300,
    d: 50,
    materialId: fixture.materialPublicId,
    difficultyLevelId: fixture.difficultyLevelPublicId,
    quantities: [1000, 2000],
    parts: [
      {
        printFront: [1, 2, 3, 4].map(() => ({ inkColourId: fixture.inkColourPublicId, percent: 100 })),
        finish1FrontId: fixture.finishPublicId,
        diecutTypeId: fixture.diecutTypePublicId,
      },
    ],
  });
  const save = async (target: string | undefined, role = 'customer') =>
    (
      await as(role)
        .post('/v1/store/quotes', {
          productTypeCode: 'folding_carton',
          configuration: configuration(),
          deliveryPostcode: '10110',
          ...(target && { targetPricePerUnit: target }),
        })
        .expect(201)
    ).body as Quote;
  const events = (type: string, aggregateId: string) =>
    prisma.domainEvent.findMany({ where: { type, aggregateId }, orderBy: { occurredAt: 'asc' } });

  it('compares every instant quantity with the target on calculation and on the saved quotation (D-247)', async () => {
    const calc = await request(server)
      .post('/v1/store/quotes/actions/calculate')
      .send({ productTypeCode: 'folding_carton', configuration: configuration(), targetPricePerUnit: '0.50' })
      .expect(200);
    expect(calc.body.target.targetPricePerUnit).toBe('0.50');
    expect(calc.body.target.steps).toHaveLength(2);
    expect(calc.body.target.steps[0]).toMatchObject({ quantity: 1000, meetsTarget: false });
    const plain = await request(server)
      .post('/v1/store/quotes/actions/calculate')
      .send({ productTypeCode: 'folding_carton', configuration: configuration() })
      .expect(200);
    expect(plain.body.target).toBeNull();
    for (const bad of ['0', '0.00', '-1', '1.234', 'abc']) {
      await request(server)
        .post('/v1/store/quotes/actions/calculate')
        .send({ productTypeCode: 'folding_carton', configuration: configuration(), targetPricePerUnit: bad })
        .expect(422);
    }

    const quote = await save('0.50');
    expect(quote.targetPricePerUnit).toBe('0.50');
    expect(quote.options.every((o) => o.targetGap && !o.targetGap.meetsTarget)).toBe(true);
    const row = await prisma.quote.findUniqueOrThrow({ where: { publicId: quote.id } });
    // Write-once (D-247).
    await expect(
      prisma.quote.update({ where: { id: row.id }, data: { targetPricePerUnit: '9.99' } }),
    ).rejects.toThrow();
    expect((await save(undefined)).options[0]!.targetGap).toBeNull();
  });

  it('computes levers once from the real engine, cheaper than the quotation, and lets the customer take one (D-248, D-249)', async () => {
    const quote = await save('0.50');
    await as('customer')
      .get(`/v1/store/quotes/${(await save(undefined)).id}/levers`)
      .expect(422);
    // Staff reading never computes them.
    const before = (await as('cs').get(`/v1/admin/quotes/${quote.id}/levers`).expect(200)).body as Levers;
    expect(before).toMatchObject({ computedAt: null, levers: [] });

    const first = (await as('customer').get(`/v1/store/quotes/${quote.id}/levers`).expect(200))
      .body as Levers;
    expect(first.status).toBe('computed');
    expect(first.levers.length).toBeGreaterThan(0);
    expect(first.levers.length).toBeLessThanOrEqual(5);
    expect(first.levers.map((l) => l.kind)).toContain('quantity');
    for (const l of first.levers) expect(Number(l.bestSavingPct)).toBeGreaterThan(0);
    const savings = first.levers.map((l) => Number(l.bestSavingPct));
    expect([...savings].sort((a, b) => b - a)).toEqual(savings);
    expect(JSON.stringify(first)).not.toContain(fixture.factoryPublicId);
    const again = (await as('customer').get(`/v1/store/quotes/${quote.id}/levers`).expect(200))
      .body as Levers;
    expect(again.levers.map((l) => l.id)).toEqual(first.levers.map((l) => l.id));
    expect(await events('quote.levers_computed', quote.id)).toHaveLength(1);
    expect((await as('cs').get(`/v1/admin/quotes/${quote.id}/levers`).expect(200)).body.levers).toHaveLength(
      first.levers.length,
    );

    const lever = first.levers[0]!;
    const taken = (
      await as('customer').post(`/v1/store/quotes/${quote.id}/levers/${lever.id}/actions/apply`).expect(201)
    ).body as Quote;
    expect(taken.fromLever).toEqual({ leverId: lever.id, quoteId: quote.id });
    expect(taken.targetPricePerUnit).toBe('0.50');
    const original = (await as('customer').get(`/v1/store/quotes/${quote.id}`).expect(200)).body as Quote;
    expect(original.status).toBe('superseded');
    expect(original.outcome).toMatchObject({ outcome: 'revised', leverTakenId: lever.id });
    await as('customer').post(`/v1/store/quotes/${quote.id}/levers/${lever.id}/actions/apply`).expect(409);
    const outcome = await prisma.quoteOutcome.findFirstOrThrow({ where: { quote: { publicId: quote.id } } });
    expect(outcome.leversShown).toBe(first.levers.length);
  });

  it('records a declined quotation as lost with its reason (D-250)', async () => {
    const quote = await save('0.50');
    await as('customer')
      .post(`/v1/store/quotes/${quote.id}/actions/decline`, { reasonCode: 'nope' })
      .expect(422);
    const declined = (
      await as('customer')
        .post(`/v1/store/quotes/${quote.id}/actions/decline`, {
          reasonCode: 'price',
          note: 'too dear (fake)',
        })
        .expect(200)
    ).body as Quote;
    expect(declined.status).toBe('declined');
    expect(declined.outcome).toMatchObject({ outcome: 'lost', lossReasonCode: 'price' });
    await as('customer').post(`/v1/store/quotes/${quote.id}/actions/decline`).expect(409);
    // Anonymous quotations can be declined by their session.
    const anon = (
      await request(server)
        .post('/v1/store/quotes')
        .send({ productTypeCode: 'folding_carton', configuration: configuration(), anonymousId })
        .expect(201)
    ).body as Quote;
    await request(server)
      .post(`/v1/store/quotes/${anon.id}/actions/decline?anonymousId=${anonymousId}`)
      .expect(200);
  });

  it('sends a quotation to CS as a pre-filled RFQ; a factory consultation never shows the target (D-251, D-190)', async () => {
    const quote = await save('0.50');
    const sent = await as('customer')
      .post(`/v1/store/quotes/${quote.id}/actions/send-to-cs`, { notes: 'ช่วยหาราคาที่ดีกว่า (fake)' })
      .expect(201);
    expect(sent.body.quoteStatus).toBe('routed_to_rfq');
    const after = (await as('customer').get(`/v1/store/quotes/${quote.id}`).expect(200)).body as Quote;
    expect(after.status).toBe('routed_to_rfq');
    expect(after.outcome?.outcome).toBe('converted_to_rfq');
    const rfq = await prisma.rfq.findUniqueOrThrow({
      where: { publicId: sent.body.rfqId },
      include: { tiers: true },
    });
    expect(rfq.targetPricePerUnit?.toFixed(2)).toBe('0.50');
    expect(rfq.routedFromQuoteId).not.toBeNull();
    expect(rfq.tiers.map((t) => t.quantity)).toEqual([1000, 2000]);
    expect(Number(rfq.lengthMm)).toBe(300);
    await as('customer').post(`/v1/store/quotes/${quote.id}/actions/send-to-cs`).expect(409);

    const staff = (await as('cs').get(`/v1/admin/rfqs/${sent.body.rfqId}`).expect(200)).body;
    expect(staff.targetPricePerUnit).toBe('0.50');
    const cs = await prisma.user.findFirstOrThrow({ where: { email: 'cs@example.invalid' } });
    await as('cs')
      .post(`/v1/admin/rfqs/${sent.body.rfqId}/actions/assign`, { userId: cs.publicId })
      .expect(200);
    await as('cs')
      .post(`/v1/admin/rfqs/${sent.body.rfqId}/consultations`, {
        factoryId: fixture.factoryPublicId,
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .expect(201);
    const consultations = await as('owner')
      .get(`/v1/partner/factories/${fixture.factoryPublicId}/rfq-consultations?status=requested`)
      .expect(200);
    const mine = JSON.stringify(consultations.body);
    expect(mine).toContain(sent.body.rfqCode);
    expect(mine).not.toMatch(/targetPrice|"0\.50"/);
  });

  it('records expiry and conversion outcomes from their events (D-250)', async () => {
    const quote = await save('0.50');
    await app.get(SavedQuotesService).expireDue(new Date(Date.now() + 16 * 86_400_000));
    const [expired] = await events('quote.expired', quote.id);
    await prisma.withTx((tx) => app.get(QuoteOutcomesService).onExpired(envelopeFromRow(expired!), tx));
    await prisma.withTx((tx) => app.get(QuoteOutcomesService).onExpired(envelopeFromRow(expired!), tx));
    const outcome = await prisma.quoteOutcome.findFirstOrThrow({ where: { quote: { publicId: quote.id } } });
    expect(outcome).toMatchObject({ outcome: 'expired', quantity: 2000 });
    expect(Number(outcome.gapPct)).toBeGreaterThan(0);
    // Write-once.
    await expect(
      prisma.quoteOutcome.update({ where: { id: outcome.id }, data: { leversShown: 9 } }),
    ).rejects.toThrow();
  });

  it('turns quotations that ended above their target into price-gap demand, withheld below 5 customers (D-252, D-190)', async () => {
    const quote = await save('0.50');
    await as('customer')
      .post(`/v1/store/quotes/${quote.id}/actions/decline`, { reasonCode: 'price' })
      .expect(200);
    const [recorded] = await events('quote.outcome_recorded', quote.id);
    const subscriber = app.get(UnmetDemandSubscriber);
    await prisma.withTx((tx) => subscriber.onQuoteOutcome(envelopeFromRow(recorded!), tx));
    await prisma.withTx((tx) => subscriber.onQuoteOutcome(envelopeFromRow(recorded!), tx));
    const records = await prisma.unmetDemandRecord.findMany({ where: { quote: { publicId: quote.id } } });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ source: 'price_above_target', priceGapBand: '50+' });
    expect(records[0]!.customerKey).toMatch(/^u\d+$/);

    // A cell of 5 distinct customers is published; the single customer above stays withheld.
    const type = await prisma.productType.findUniqueOrThrow({ where: { code: 'folding_carton' } });
    await prisma.unmetDemandRecord.createMany({
      data: [1, 2, 3, 4, 5].map((i) => ({
        source: 'price_above_target' as const,
        productTypeId: type.id,
        specBand: {},
        quantityBand: '100-499',
        quoteId: records[0]!.quoteId,
        priceGapBand: '10-25',
        customerKey: `u-fake-${run}-${i}`,
      })),
    });
    // Unmet demand is bucketed by Bangkok day (the UTC date is yesterday before 07:00 in Bangkok).
    const today = bangkokDate(new Date());
    const report = await as('marketing')
      .get(`/v1/admin/analytics/unmet-demand?from=${today}&to=${today}`)
      .expect(200);
    const gap = report.body.priceGap as {
      minGroupSize: number;
      rows: { priceGapBand: string; customers: number }[];
    };
    expect(gap.minGroupSize).toBe(5);
    expect(gap.rows.every((r) => r.customers >= 5)).toBe(true);
    expect(gap.rows.some((r) => r.priceGapBand === '10-25')).toBe(true);
    expect(gap.rows.some((r) => r.priceGapBand === '50+')).toBe(false);
    expect(JSON.stringify(report.body.bySource)).not.toContain('price_above_target');
    const content = await app.get(ProspectusService).content(today, today, 3, []);
    const table = content.tables.find((t) => t.key === 'price_gap')!;
    const published = table.rows.filter((r) => r.values[0] !== null);
    expect(published.every((r) => r.labels[3] === '10-25')).toBe(true);
    expect(JSON.stringify(table)).not.toContain('u-fake');
    const unmet = content.tables.find((t) => t.key === 'unmet_demand')!;
    expect(JSON.stringify(unmet)).not.toContain('price_above_target');
  });
});
