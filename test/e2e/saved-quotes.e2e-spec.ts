import { PrismaService } from '@database/prisma.service';
import { type FakePdfRenderer } from '@integrations/pdf/fake-pdf-renderer';
import { PDF_RENDERER } from '@integrations/pdf/pdf-renderer.port';
import { type FakeSmsSender } from '@integrations/sms/fake-sms-sender';
import { SMS_SENDER } from '@integrations/sms/sms-sender.port';
import { QUOTE_REPRICER, type QuoteRepricer } from '@modules/partners/pricing/quote-repricer.port';
import { QuotePdfService } from '@modules/quotes/quote-pdf.service';
import { SavedQuotesService } from '@modules/quotes/saved-quotes.service';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { envelopeFromRow } from '@platform/domain-events/domain-event';
import request from 'supertest';

import { type DevFolding, seedDevFolding } from '../../prisma/seed/dev-folding';
import { seedDev } from '../../prisma/seed/dev-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from '../support/e2e';

/** Saved quotations: snapshot, 15-day lock, share links, PDF, re-pricing (B2.5, D-051). */
describe('saved quotes (e2e, B2.5)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let fixture: DevFolding;
  const tokens: Record<string, string> = {};
  const run = (Date.now() % 1_000_000) + 500_000;
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
    for (const role of ['cs', 'partner-manager', 'prepress']) {
      const res = await request(server)
        .post('/v1/auth/staff/login')
        .send({ email: `${role}@example.invalid`, password: E2E_DEV_PASSWORD })
        .expect(200);
      tokens[role] = res.body.accessToken as string;
    }
    const phone = `08${String(run).padStart(8, '0').slice(-8)}`;
    const requested = await request(server).post('/v1/auth/customer/otp/request').send({ phone }).expect(200);
    const sms = app.get<FakeSmsSender>(SMS_SENDER);
    const code = /\b(\d{6})\b/.exec(sms.lastTo(`+66${phone.slice(1)}`)!.text)![1]!;
    const verified = await request(server)
      .post('/v1/auth/customer/otp/verify')
      .send({ challengeId: requested.body.challengeId, code })
      .expect(200);
    tokens['customer'] = verified.body.accessToken as string;
  });

  afterAll(async () => {
    // Other suites expect folding to stay RFQ until its type is switched (A-16).
    await prisma?.productType.update({ where: { code: 'folding_carton' }, data: { quoteMode: 'rfq' } });
    await app?.close();
  });

  const as = (role: string) => ({
    get: (url: string) => request(server).get(url).auth(tokens[role]!, { type: 'bearer' }),
    post: (url: string, body: object = {}) =>
      request(server).post(url).auth(tokens[role]!, { type: 'bearer' }).send(body),
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
    design: { graphic: true, structure: false },
  });
  const body = () => ({ productTypeCode: 'folding_carton', configuration: configuration() });

  it('saves a server-priced snapshot valid for 15 days, linked to its calculation (D-051)', async () => {
    const saved = await as('customer').post('/v1/store/quotes', body()).expect(201);
    expect(saved.body).toMatchObject({
      status: 'saved',
      source: 'instant',
      priceLocked: true,
      quoteCode: null,
      pdfStatus: 'none',
    });
    expect((saved.body.options as { quantity: number }[]).map((o) => o.quantity)).toEqual([1000, 2000]);
    expect(JSON.stringify(saved.body)).not.toContain(fixture.factoryPublicId);
    const days = (Date.parse(saved.body.validUntil) - Date.parse(saved.body.createdAt)) / 86_400_000;
    expect(Math.round(days)).toBe(15);
    const row = await prisma.quote.findUniqueOrThrow({
      where: { publicId: saved.body.id },
      include: { options: true },
    });
    expect(row.snapshotSha256).toHaveLength(32);
    expect(row.options[0]!.selectedFactoryId).not.toBeNull();
    expect(await prisma.calculateLog.count({ where: { quoteId: row.id } })).toBe(1);
    const configRefs = row.configRefs as { settingVersionIds: Record<string, string> };
    expect(configRefs.settingVersionIds['quotes.validity_days']).toBeDefined();
    // Write-once snapshot.
    await expect(prisma.quote.update({ where: { id: row.id }, data: { input: {} } })).rejects.toThrow();
    await expect(
      prisma.quoteOption.update({ where: { id: row.options[0]!.id }, data: { quantity: 1 } }),
    ).rejects.toThrow();

    const mine = await as('customer').get('/v1/store/quotes').expect(200);
    expect((mine.body.data as { id: string }[]).map((q) => q.id)).toContain(saved.body.id);
    await as('customer').post(`/v1/store/quotes/${saved.body.id}/actions/reprice`).expect(409);
  });

  it('lets an anonymous session save and a signed-in customer claim it', async () => {
    await request(server).post('/v1/store/quotes').send(body()).expect(422);
    const saved = await request(server)
      .post('/v1/store/quotes')
      .send({ ...body(), anonymousId })
      .expect(201);
    await request(server).get(`/v1/store/quotes/${saved.body.id}`).expect(404);
    await request(server).get(`/v1/store/quotes/${saved.body.id}?anonymousId=${anonymousId}`).expect(200);
    await as('customer')
      .post(`/v1/store/quotes/${saved.body.id}/actions/claim`, {
        anonymousId: '0192f3a0-7c1e-7d2a-9b1f-000000000000',
      })
      .expect(404);
    await as('customer').post(`/v1/store/quotes/${saved.body.id}/actions/claim`, { anonymousId }).expect(200);
    await as('customer').get(`/v1/store/quotes/${saved.body.id}`).expect(200);
    // Once claimed, the anonymous session no longer reads it.
    await request(server).get(`/v1/store/quotes/${saved.body.id}?anonymousId=${anonymousId}`).expect(404);
  });

  it('shares with a QT number and a revocable link, then renders the PDF in the entity’s name (D-010, D-092)', async () => {
    const saved = await as('customer').post('/v1/store/quotes', body()).expect(201);
    const first = await as('customer').post(`/v1/store/quotes/${saved.body.id}/actions/share`).expect(200);
    expect(first.body.quote).toMatchObject({ status: 'shared' });
    expect(first.body.quote.quoteCode).toMatch(/^DEVQT-\d{4}-\d{6}$/);
    await request(server)
      .get(first.body.sharePath as string)
      .expect(200);
    const second = await as('customer').post(`/v1/store/quotes/${saved.body.id}/actions/share`).expect(200);
    expect(second.body.quote.quoteCode).toBe(first.body.quote.quoteCode);
    await request(server)
      .get(first.body.sharePath as string)
      .expect(404);
    const opened = await request(server)
      .get(second.body.sharePath as string)
      .expect(200);
    expect(opened.body.id).toBe(saved.body.id);

    const requested = await as('customer')
      .post(`/v1/store/quotes/${saved.body.id}/actions/request-pdf`)
      .expect(202);
    expect(requested.body.pdfStatus).toBe('pending');
    expect((await as('customer').get(`/v1/store/quotes/${saved.body.id}/pdf`).expect(200)).body.status).toBe(
      'pending',
    );
    const event = await prisma.domainEvent.findFirstOrThrow({
      where: { type: 'quote.pdf_requested', aggregateId: saved.body.id },
    });
    await prisma.withTx((tx) => app.get(QuotePdfService).onPdfRequested(envelopeFromRow(event), tx));
    const pdf = await as('customer').get(`/v1/store/quotes/${saved.body.id}/pdf`).expect(200);
    expect(pdf.body.status).toBe('ready');
    expect(pdf.body.url).toMatch(/^https?:\/\//);
    const html = app.get<FakePdfRenderer>(PDF_RENDERER).rendered.at(-1)!;
    expect(html).toContain(first.body.quote.quoteCode);
    expect(html).toContain('ข้อมูลปลอม');
    expect(html).toContain('ใบเสนอราคา');
  });

  it('expires quotes after their validity and re-prices them into a new quote (D-051)', async () => {
    const saved = await as('customer').post('/v1/store/quotes', body()).expect(201);
    const expired = await app.get(SavedQuotesService).expireDue(new Date(Date.now() + 16 * 86_400_000));
    expect(expired).toBeGreaterThan(0);
    const old = await as('customer').get(`/v1/store/quotes/${saved.body.id}`).expect(200);
    expect(old.body).toMatchObject({ status: 'expired', priceLocked: false });
    await as('customer').post(`/v1/store/quotes/${saved.body.id}/actions/share`).expect(409);
    const fresh = await as('customer').post(`/v1/store/quotes/${saved.body.id}/actions/reprice`).expect(201);
    expect(fresh.body).toMatchObject({ status: 'saved', priceLocked: true });
    expect(fresh.body.id).not.toBe(saved.body.id);
    expect((await as('customer').get(`/v1/store/quotes/${saved.body.id}`).expect(200)).body.status).toBe(
      'superseded',
    );
    expect(
      await prisma.domainEvent.count({ where: { type: 'quote.expired', aggregateId: saved.body.id } }),
    ).toBe(1);
  });

  it('lets CS save for a customer and shows staff the factory view by D-141 grants', async () => {
    const customer = await prisma.user.findFirstOrThrow({
      where: { kind: 'customer', email: 'customer@example.invalid' },
    });
    await as('prepress').post('/v1/admin/quotes', body()).expect(403);
    const saved = await as('cs')
      .post('/v1/admin/quotes', { ...body(), customerUserId: customer.publicId })
      .expect(201);
    expect(saved.body).toMatchObject({ channel: 'cs', customer: { id: customer.publicId } });
    expect(saved.body.options[0].internal).toMatchObject({
      factoryId: fixture.factoryPublicId,
      buyPrice: null,
      marginPct: null,
    });
    const pm = await as('partner-manager').get(`/v1/admin/quotes/${saved.body.id}`).expect(403);
    expect(pm.body.code).toBe('auth.forbidden');
    const listed = await as('cs').get(`/v1/admin/quotes?customerId=${customer.publicId}`).expect(200);
    expect((listed.body.data as { id: string }[]).map((q) => q.id)).toContain(saved.body.id);
    // The saved quote now feeds the impact simulation of price proposals (D-040 note).
    const factory = await prisma.factory.findUniqueOrThrow({ where: { publicId: fixture.factoryPublicId } });
    const repricer = app.get<QuoteRepricer>(QUOTE_REPRICER);
    const none = await repricer.reprice({
      factoryId: factory.id,
      productTypeId: saved.body
        ? (await prisma.productType.findUniqueOrThrow({ where: { code: 'folding_carton' } })).id
        : 0n,
      proposalId: 0n,
      windowFrom: new Date(Date.now() + 86_400_000),
      windowTo: new Date(Date.now() + 2 * 86_400_000),
    });
    expect(none.quotesInWindow).toBe(0);
  });
});
