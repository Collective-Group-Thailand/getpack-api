import { randomUUID } from 'node:crypto';

import { type FakeSmsSender, SMS_SENDER } from '@collective/integrations/sms';
import { PrismaService } from '@database/prisma.service';
import { RfqsService } from '@modules/rfq/rfqs.service';
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

interface Rfq {
  id: string;
  rfqCode: string;
  status: string;
  quotations: { id: string; status: string; lines: { quantity: number; grossAmount: string }[] }[];
  consultations?: { id: string; status: string; lines: unknown }[];
  messages: { author: string; body: string; visibility?: string }[];
  acceptedQuoteId: string | null;
}

/** Requests for quote: customer, CS, factory consultation, quotation, acceptance, unmet demand (B2.5). */
describe('requests for quote (e2e, B2.5)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let fixture: DevFolding;
  const tokens: Record<string, string> = {};
  const run = (Date.now() % 1_000_000) + 500_000;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    await seedDev(prisma, E2E_DEV_PASSWORD);
    fixture = (await prisma.$transaction((tx) => seedDevFolding(tx), { timeout: 60_000 })).fixture;
    for (const role of ['cs', 'partner-manager', 'superadmin', 'prepress']) {
      const res = await request(server)
        .post('/v1/auth/staff/login')
        .send({ email: `${role}@example.invalid`, password: E2E_DEV_PASSWORD })
        .expect(200);
      tokens[role] = res.body.accessToken as string;
    }
    const phone = `09${String(run).padStart(8, '0').slice(-8)}`;
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
    const email = `rfq-owner-${run}@factory.example`;
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
    await prisma?.productType.update({
      where: { code: 'paper_bag' },
      data: { rfqSpecSchema: null as never },
    });
    await app?.close();
  });

  const as = (role: string) => ({
    get: (url: string) => request(server).get(url).auth(tokens[role]!, { type: 'bearer' }),
    put: (url: string, body: object = {}) =>
      request(server).put(url).auth(tokens[role]!, { type: 'bearer' }).send(body),
    post: (url: string, body: object = {}) =>
      request(server)
        .post(url)
        .auth(tokens[role]!, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send(body),
  });

  const submission = (over: object = {}) => ({
    productTypeCode: 'paper_bag',
    spec: { material: 'kraft 150 gsm (fake)' },
    lengthMm: 250,
    widthMm: 120,
    heightMm: 320,
    quantities: [3000, 500, 1000],
    targetDate: '2026-12-15',
    deliveryPostcode: '10110',
    notes: 'Logo on both sides (fake)',
    ...over,
  });

  it('validates the spec against the category schema and numbers the request', async () => {
    await prisma.productType.update({
      where: { code: 'paper_bag' },
      data: {
        rfqSpecSchema: {
          type: 'object',
          required: ['material'],
          properties: { material: { type: 'string', minLength: 3 } },
        },
      },
    });
    const bad = await as('customer')
      .post('/v1/store/rfqs', submission({ spec: { colour: 'red' } }))
      .expect(422);
    expect(bad.body.errors[0].path).toBe('spec.material');
    await as('customer')
      .post('/v1/store/rfqs', submission({ quantities: [500, 500] }))
      .expect(422);
    const rfq = (await as('customer').post('/v1/store/rfqs', submission()).expect(201)).body as Rfq & {
      quantities: number[];
      slaDueAt: string | null;
    };
    expect(rfq.rfqCode).toMatch(/^DEVRFQ-\d{4}-\d{5}$/);
    expect(rfq).toMatchObject({ status: 'submitted', quantities: [500, 1000, 3000], slaDueAt: null });
  });

  it('serves the typed form, refuses an outdated one, keeps files and links the routing calculation (U-B0.1)', async () => {
    const type = await prisma.productType.update({
      where: { code: 'paper_bag' },
      data: {
        rfqSpecSchema: {
          type: 'object',
          required: ['material'],
          properties: { material: { type: 'string', title: 'วัสดุ', 'x-title-en': 'Material' } },
          'x-dimensions': { required: true },
        },
        rfqSpecSchemaVersion: { increment: 1 },
      },
    });
    const form = (await request(server).get('/v1/store/rfq-forms/paper_bag').expect(200)).body as {
      specSchemaVersion: number;
    };
    expect(form).toMatchObject({
      productTypeCode: 'paper_bag',
      specSchemaVersion: type.rfqSpecSchemaVersion,
      fields: [{ key: 'material', type: 'text', labelTh: 'วัสดุ', labelEn: 'Material', required: true }],
      dimensions: { asked: true, required: true, height: true },
      quantity: { min: 1, maxTiers: 10 },
      files: { purpose: 'artwork', maxFiles: 20 },
      slaTargetHours: null,
    });
    await request(server).get('/v1/store/rfq-forms/no_such_type').expect(404);
    const stale = await as('customer')
      .post('/v1/store/rfqs', submission({ specSchemaVersion: form.specSchemaVersion - 1 }))
      .expect(422);
    expect(stale.body.errors[0]).toMatchObject({ path: 'specSchemaVersion', code: 'outdated' });

    const me = (await as('customer').get('/v1/store/me').expect(200)).body as { id: string };
    const owner = await prisma.user.findUniqueOrThrow({ where: { publicId: me.id } });
    const upload = (name: string) =>
      prisma.fileObject.create({
        data: {
          bucket: 'test',
          storageKey: `customer/e2e/${run}/${name}`,
          originalName: name,
          mimeType: 'application/pdf',
          sizeBytes: 1024n,
          uploadStatus: 'uploaded',
          scanStatus: 'clean',
          ownerUserId: owner.id,
        },
      });
    const brief = await upload('brief.pdf');
    const log = await prisma.calculateLog.create({
      data: {
        occurredAt: new Date(),
        channel: 'web',
        productTypeId: type.id,
        quantities: [1000],
        input: {},
        inputSchemaVersion: 1,
        resultSummary: {},
        instantPath: false,
        routedToRfq: true,
        durationMs: 1,
      },
    });
    const rfq = (
      await as('customer')
        .post(
          '/v1/store/rfqs',
          submission({
            specSchemaVersion: form.specSchemaVersion,
            fileIds: [brief.publicId],
            routedFrom: { calculationId: log.publicId },
          }),
        )
        .expect(201)
    ).body as Rfq & { files: { id: string; originalName: string }[] };
    expect(rfq.files).toEqual([expect.objectContaining({ id: brief.publicId, originalName: 'brief.pdf' })]);
    const stored = await prisma.rfq.findUniqueOrThrow({ where: { publicId: rfq.id } });
    expect(stored).toMatchObject({
      routedFromCalculateLogId: log.id,
      specSchemaVersion: form.specSchemaVersion,
    });

    const photo = await upload('photo.pdf');
    const replied = await as('customer')
      .post(`/v1/store/rfqs/${rfq.id}/messages`, { body: 'Reference (fake)', fileIds: [photo.publicId] })
      .expect(201);
    const message = (replied.body.messages as { body: string; files: { id: string }[] }[]).find(
      (m) => m.body === 'Reference (fake)',
    );
    expect(message?.files.map((f) => f.id)).toEqual([photo.publicId]);
  });

  it('runs the request through CS, a factory consultation, a quotation and the customer’s acceptance (D-100)', async () => {
    const rfq = (await as('customer').post('/v1/store/rfqs', submission()).expect(201)).body as Rfq;
    const admin = `/v1/admin/rfqs/${rfq.id}`;
    await as('prepress').get(admin).expect(403);
    const cs = await prisma.user.findFirstOrThrow({ where: { email: 'cs@example.invalid' } });
    expect(
      (await as('cs').post(`${admin}/actions/assign`, { userId: cs.publicId }).expect(200)).body.status,
    ).toBe('in_review');
    await as('cs')
      .post(`${admin}/messages`, { body: 'margin note (fake)', visibility: 'internal' })
      .expect(201);
    expect(
      (await as('cs').post(`${admin}/actions/request-info`, { body: 'Which colours? (fake)' }).expect(200))
        .body.status,
    ).toBe('need_info');
    const mine = await as('customer')
      .post(`/v1/store/rfqs/${rfq.id}/messages`, { body: 'One colour (fake)' })
      .expect(201);
    expect(mine.body.status).toBe('in_review');
    // The customer never sees internal notes.
    expect((mine.body as Rfq).messages.map((m) => m.body)).not.toContain('margin note (fake)');

    await as('cs')
      .post(`${admin}/consultations`, {
        factoryId: fixture.factoryPublicId,
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .expect(201);
    await as('cs')
      .post(`${admin}/consultations`, {
        factoryId: fixture.factoryPublicId,
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .expect(409);
    // U-B0.2: the desk's filters and the staff view's extras.
    const awaiting = (await as('cs').get('/v1/admin/rfqs?awaitingFactory=true&perPage=100').expect(200)).body
      .data as {
      id: string;
    }[];
    expect(awaiting.map((r) => r.id)).toContain(rfq.id);
    expect(
      (
        (await as('cs').get('/v1/admin/rfqs?channel=cs&perPage=100').expect(200)).body.data as {
          id: string;
        }[]
      ).map((r) => r.id),
    ).not.toContain(rfq.id);
    const staffView = (await as('cs').get(admin).expect(200)).body;
    expect(staffView).toMatchObject({
      contact: { phone: expect.any(String) },
      routedFromCalculator: false,
      quoteDefaults: { validUntil: expect.any(String) },
      consultations: [
        expect.objectContaining({ requestedBy: { id: cs.publicId, displayName: expect.any(String) } }),
      ],
    });
    expect(staffView.specLines.length).toBeGreaterThan(0);
    const reasons = (await as('cs').get('/v1/admin/unmet-demand-reasons').expect(200)).body as {
      code: string;
    }[];
    expect(reasons.length).toBeGreaterThan(0);
    expect(
      (await as('cs').post(`${admin}/actions/assign`, { userId: null }).expect(200)).body.assignedTo,
    ).toBeNull();

    const partner = `/v1/partner/factories/${fixture.factoryPublicId}/rfq-consultations`;
    const open = (await as('owner').get(`${partner}?status=requested`).expect(200)).body as {
      id: string;
      rfqCode: string;
    }[];
    const consultation = open.find((c) => c.rfqCode === rfq.rfqCode)!;
    expect(JSON.stringify(consultation)).not.toMatch(/customer|10110/i);
    await as('owner')
      .post(`${partner}/${consultation.id}/actions/respond`, {
        lines: [{ quantity: 777, buyUnitPrice: '1', leadTimeDays: 1 }],
      })
      .expect(422);
    await as('owner')
      .post(`${partner}/${consultation.id}/actions/respond`, {
        lines: [{ quantity: 1000, buyUnitPrice: '9.800000', leadTimeDays: 12 }],
      })
      .expect(200);
    const staff = (await as('cs').get(admin).expect(200)).body as Rfq;
    // CS has no D-141 cost grant: the factory's answer is hidden.
    expect(staff.consultations![0]).toMatchObject({ status: 'responded', lines: null });
    const pm = (await as('superadmin').get(admin).expect(200)).body as Rfq;
    expect(pm.consultations![0]!.lines).toEqual([
      { quantity: 1000, buyUnitPrice: '9.800000', leadTimeDays: 12 },
    ]);

    const line = (quantity: number, unitPrice: string) => ({
      quantity,
      unitPrice,
      shippingNetAmount: '300.00',
      leadTimeDays: 14,
      buyUnitPrice: '9.800000',
    });
    const drafted = (
      await as('cs')
        .post(`${admin}/quotations`, { lines: [line(1000, '12.5'), line(3000, '11.9')] })
        .expect(201)
    ).body as Rfq;
    await as('cs')
      .post(`${admin}/quotations`, { lines: [line(1000, '13')] })
      .expect(409);
    // Drafts stay internal.
    expect(
      ((await as('customer').get(`/v1/store/rfqs/${rfq.id}`).expect(200)).body as Rfq).quotations,
    ).toHaveLength(0);
    const v1 = drafted.quotations[0]!;
    expect(v1.lines[0]).toMatchObject({ quantity: 1000, grossAmount: '13696.00' });
    expect(
      (await as('cs').post(`/v1/admin/rfq-quotations/${v1.id}/actions/send`).expect(200)).body.status,
    ).toBe('quoted');
    // A second version supersedes the first once sent.
    const again = (
      await as('cs')
        .post(`${admin}/quotations`, { lines: [line(1000, '12.2')] })
        .expect(201)
    ).body as Rfq;
    const v2 = again.quotations.find((q) => q.status === 'draft')!;
    await as('cs').post(`/v1/admin/rfq-quotations/${v2.id}/actions/send`).expect(200);
    const view = (await as('customer').get(`/v1/store/rfqs/${rfq.id}`).expect(200)).body as Rfq;
    expect(view.quotations.map((q) => q.status)).toEqual(['sent', 'superseded']);
    await as('customer').post(`/v1/store/rfqs/${rfq.id}/actions/accept`, { rfqQuoteId: v1.id }).expect(409);

    const accepted = (
      await as('customer').post(`/v1/store/rfqs/${rfq.id}/actions/accept`, { rfqQuoteId: v2.id }).expect(200)
    ).body as Rfq;
    expect(accepted.status).toBe('accepted');
    const quote = await as('customer').get(`/v1/store/quotes/${accepted.acceptedQuoteId}`).expect(200);
    expect(quote.body).toMatchObject({
      source: 'rfq',
      status: 'saved',
      priceLocked: true,
      configuration: null,
    });
    expect(quote.body.options[0]).toMatchObject({ quantity: 1000, netAmount: '12500.00' });
    // D-187 (F2): the accepted quote freezes a tolerance like an instant quote — never none, never 0 %.
    expect(quote.body.options[0]).toMatchObject({
      toleranceShortagePct: expect.stringMatching(/^\d+\.\d{4}$/),
      toleranceOveragePct: expect.stringMatching(/^\d+\.\d{4}$/),
      // A paper bag has no calculator: no dimensional or colour tolerance is published for it (D-186).
      toleranceDimensionalMm: null,
      toleranceColourDeltaE: null,
    });
    expect(Number(quote.body.options[0].toleranceShortagePct)).toBeGreaterThan(0);
    // The RFQ's spec and dimensions become the quote's spec lines (U-B0.1).
    expect(quote.body.summary).toMatchObject({
      product: null,
      productTypeCode: 'paper_bag',
      unit: 'piece',
      specs: [
        expect.objectContaining({ key: 'size', valueEn: '120 × 250 × 320 mm' }),
        expect.objectContaining({ key: 'material', valueTh: 'kraft 150 gsm (fake)' }),
      ],
    });
    await as('customer').post(`/v1/store/rfqs/${rfq.id}/messages`, { body: 'late (fake)' }).expect(409);
  });

  it('lets CS start a review, pick factories, remind them, revise the draft and record an acceptance (U-B0.2)', async () => {
    const rfq = (await as('customer').post('/v1/store/rfqs', submission()).expect(201)).body as Rfq;
    const admin = `/v1/admin/rfqs/${rfq.id}`;
    expect((await as('cs').post(`${admin}/actions/start-review`).expect(200)).body.status).toBe('in_review');
    expect((await as('cs').post(`${admin}/actions/start-review`).expect(409)).body.code).toBe(
      'rfq.invalid_transition',
    );

    const candidates = (await as('cs').get(`${admin}/candidate-factories`).expect(200)).body as {
      factoryId: string;
      alreadyConsulted: boolean;
    }[];
    expect(JSON.stringify(candidates)).not.toMatch(/price/i);
    const consulted = await as('cs')
      .post(`${admin}/consultations`, {
        factoryId: fixture.factoryPublicId,
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .expect(201);
    const consultationId = (consulted.body as Rfq).consultations![0]!.id;
    await as('cs').post(`/v1/admin/rfq-consultations/${consultationId}/actions/remind`).expect(204);
    expect(
      (await as('cs').post(`/v1/admin/rfq-consultations/${consultationId}/actions/remind`).expect(409)).body
        .code,
    ).toBe('rfq.reminder_recent');
    expect(
      await prisma.domainEvent.count({ where: { type: 'rfq.consultation_reminded', aggregateId: rfq.id } }),
    ).toBe(1);
    const after = (await as('cs').get(`${admin}/candidate-factories`).expect(200)).body as typeof candidates;
    expect(after.find((c) => c.factoryId === fixture.factoryPublicId)?.alreadyConsulted ?? true).toBe(true);

    const line = (quantity: number, unitPrice: string) => ({
      quantity,
      unitPrice,
      shippingNetAmount: '300.00',
      leadTimeDays: 14,
    });
    const drafted = (
      await as('cs')
        .post(`${admin}/quotations`, { lines: [line(1000, '12.5')] })
        .expect(201)
    ).body as Rfq;
    const draft = drafted.quotations.find((q) => q.status === 'draft')!;
    const got = await as('cs').get(admin).expect(200);
    const etag = got.headers['etag'] as string;
    await as('cs')
      .put(`/v1/admin/rfq-quotations/${draft.id}`, { lines: [line(1000, '12')] })
      .expect(428);
    const revised = await as('cs')
      .put(`/v1/admin/rfq-quotations/${draft.id}`, { lines: [line(1000, '12'), line(3000, '11')] })
      .set('If-Match', etag)
      .expect(200);
    expect(
      (revised.body as Rfq).quotations.find((q) => q.id === draft.id)!.lines.map((l) => l.quantity),
    ).toEqual([1000, 3000]);
    await as('cs')
      .put(`/v1/admin/rfq-quotations/${draft.id}`, { lines: [line(1000, '11')] })
      .set('If-Match', etag)
      .expect(412);
    await as('cs').post(`/v1/admin/rfq-quotations/${draft.id}/actions/send`).expect(200);

    const accepted = await as('cs')
      .post(`/v1/admin/rfq-quotations/${draft.id}/actions/record-acceptance`, {
        quantities: [3000],
        via: 'phone',
      })
      .expect(200);
    expect(accepted.body).toMatchObject({ status: 'accepted', acceptedQuoteId: expect.any(String) });
    expect(
      await prisma.auditLog.count({ where: { action: 'rfq.acceptance_recorded', resourcePublicId: rfq.id } }),
    ).toBe(1);
    const quote = await as('customer')
      .get(`/v1/store/quotes/${accepted.body.acceptedQuoteId as string}`)
      .expect(200);
    expect((quote.body as { options: { quantity: number }[] }).options.map((o) => o.quantity)).toEqual([
      3000,
    ]);
  });

  it('records declined and expired requests as unmet demand (D-102)', async () => {
    const declined = (await as('customer').post('/v1/store/rfqs', submission()).expect(201)).body as Rfq;
    await as('cs').post(`/v1/admin/rfqs/${declined.id}/actions/decline`, { reasonCode: 'nope' }).expect(422);
    const done = (
      await as('cs')
        .post(`/v1/admin/rfqs/${declined.id}/actions/decline`, { reasonCode: 'capability_missing' })
        .expect(200)
    ).body;
    expect(done).toMatchObject({ status: 'declined', declineReasonCode: 'capability_missing' });

    const quoted = (await as('customer').post('/v1/store/rfqs', submission()).expect(201)).body as Rfq;
    const drafted = (
      await as('cs')
        .post(`/v1/admin/rfqs/${quoted.id}/quotations`, {
          lines: [{ quantity: 500, unitPrice: '15', leadTimeDays: 10 }],
        })
        .expect(201)
    ).body as Rfq;
    await as('cs').post(`/v1/admin/rfq-quotations/${drafted.quotations[0]!.id}/actions/send`).expect(200);
    await app.get(RfqsService).expireDue(new Date(Date.now() + 16 * 86_400_000));
    expect(((await as('customer').get(`/v1/store/rfqs/${quoted.id}`).expect(200)).body as Rfq).status).toBe(
      'expired',
    );

    const subscriber = app.get(UnmetDemandSubscriber);
    for (const [type, id] of [
      ['rfq.declined', declined.id],
      ['rfq.expired', quoted.id],
    ] as const) {
      const event = await prisma.domainEvent.findFirstOrThrow({ where: { type, aggregateId: id } });
      await prisma.withTx((tx) => subscriber.onRfqClosed(envelopeFromRow(event), tx));
      await prisma.withTx((tx) => subscriber.onRfqClosed(envelopeFromRow(event), tx));
    }
    const records = await prisma.unmetDemandRecord.findMany({
      where: { rfq: { publicId: { in: [declined.id, quoted.id] } } },
      include: { reason: true },
      orderBy: { id: 'asc' },
    });
    expect(records.map((r) => [r.source, r.reason?.code, r.quantityBand])).toEqual([
      ['rfq_declined', 'capability_missing', '1000-4999'],
      ['rfq_expired', 'expired', '1000-4999'],
    ]);
    expect(records[0]!.specBand).toEqual({ lengthMm: 250, widthMm: 100, heightMm: 300, tiers: 3 });
  });
});
