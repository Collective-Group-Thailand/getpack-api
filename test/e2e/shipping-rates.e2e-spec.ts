import { randomUUID } from 'node:crypto';

import { PrismaService } from '@database/prisma.service';
import { type FakeObjectStorage } from '@integrations/s3/fake-object-storage';
import { OBJECT_STORAGE } from '@integrations/s3/object-storage.port';
import { writeWorkbook } from '@modules/catalog/imports/workbook';
import { CustomerRatesService } from '@modules/shipping/rates/customer-rates.service';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { envelopeFromRow } from '@platform/domain-events/domain-event';
import { FileProcessingJobs } from '@platform/files/file-processing.jobs';
import request from 'supertest';

import { seedDev } from '../../prisma/seed/dev-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from '../support/e2e';

function taxId(seed: number): string {
  const body = `0000${String(seed).padStart(8, '0')}`;
  const sum = [...body].map(Number).reduce((acc, d, i) => acc + d * (13 - i), 0);
  return `${body}${(11 - (sum % 11)) % 10}`;
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Customer shipping rate card and factory payout cards (B2.4, D-013). */
describe('shipping rate cards (e2e, B2.4)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};
  const run = (Date.now() % 1_000_000) + 500_000;
  // Postcodes of this run only (a postcode maps to one zone per scheme).
  const postcode = (n: number) => String(90_000 + ((run + n * 7919) % 9_999)).padStart(5, '0');
  let zoneA: { id: string; code: string };
  let zoneB: { id: string; code: string };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    await seedDev(prisma, E2E_DEV_PASSWORD);
    for (const role of ['superadmin', 'logistics', 'c-level', 'cs', 'prepress', 'partner-manager']) {
      const res = await request(server)
        .post('/v1/auth/staff/login')
        .send({ email: `${role}@example.invalid`, password: E2E_DEV_PASSWORD })
        .expect(200);
      tokens[role] = res.body.accessToken as string;
    }
    const scheme = await prisma.zoneScheme.findUniqueOrThrow({ where: { code: 'customer_default' } });
    const zone = async (code: string, postcodes: string[]) => {
      const created = await as('partner-manager')
        .post('/v1/admin/shipping/zones', { schemeId: scheme.publicId, code, nameTh: code, nameEn: code })
        .expect(201);
      await as('partner-manager')
        .put(
          `/v1/admin/shipping/zones/${created.body.id}/postcodes`,
          { postcodes },
          created.headers['etag'] as string,
        )
        .expect(200);
      return { id: created.body.id as string, code };
    };
    zoneA = await zone(`e2e_a_${run}`, [postcode(1), postcode(2)]);
    zoneB = await zone(`e2e_b_${run}`, [postcode(3)]);
  });

  afterAll(async () => {
    await app?.close();
  });

  const as = (role: string) => ({
    get: (url: string) => request(server).get(url).auth(tokens[role]!, { type: 'bearer' }),
    post: (url: string, body: object) =>
      request(server).post(url).auth(tokens[role]!, { type: 'bearer' }).send(body),
    put: (url: string, body: object, ifMatch?: string) => {
      const req = request(server).put(url).auth(tokens[role]!, { type: 'bearer' });
      return (ifMatch ? req.set('If-Match', ifMatch) : req).send(body);
    },
    delete: (url: string) => request(server).delete(url).auth(tokens[role]!, { type: 'bearer' }),
  });

  /** Uploads a workbook (presign → PUT → complete) and lets the worker scan it. */
  async function upload(sheets: Parameters<typeof writeWorkbook>[0]): Promise<string> {
    const body = await writeWorkbook(sheets);
    const presigned = await as('logistics')
      .post('/v1/admin/files/presign', {
        purpose: 'import',
        fileName: 'rates.xlsx',
        mimeType: XLSX,
        sizeBytes: body.length,
      })
      .expect(201);
    const row = await prisma.fileObject.findUniqueOrThrow({
      where: { publicId: presigned.body.fileId as string },
    });
    app.get<FakeObjectStorage>(OBJECT_STORAGE).putDirect(row.storageKey, body, XLSX);
    await as('logistics').post(`/v1/admin/files/${presigned.body.fileId}/actions/complete`, {}).expect(200);
    await app.get(FileProcessingJobs).processUploaded();
    return presigned.body.fileId as string;
  }

  const outcome = async (approvalId: string) => {
    const event = await prisma.domainEvent.findFirstOrThrow({
      where: { type: { in: ['approval.approved', 'approval.rejected'] }, aggregateId: approvalId },
    });
    await prisma.withTx((tx) => app.get(CustomerRatesService).onApprovalOutcome(envelopeFromRow(event), tx));
  };

  const rate = (zoneId: string, over: object = {}) => ({
    zoneId,
    postcode: null,
    weightMinG: 0,
    weightMaxG: 5000,
    volumeMinCm3: null,
    volumeMaxCm3: null,
    priceAmount: '120.00',
    perExtraKg: null,
    ...over,
  });

  it('lets Logistics draft rates, refusing overlaps and postcodes outside the zone', async () => {
    const base = '/v1/admin/shipping/customer-rate-card';
    const card = await as('cs').get(base).expect(200);
    expect(card.body.key).toBe('default');
    await as('cs')
      .post(`${base}/versions`, { effectiveFrom: new Date().toISOString(), reason: 'x' })
      .expect(403);
    await as('prepress').get(base).expect(403);

    const overlap = await as('logistics')
      .post(`${base}/versions`, {
        effectiveFrom: new Date().toISOString(),
        reason: 'overlap (fake)',
        rates: [rate(zoneA.id), rate(zoneA.id, { weightMinG: 4000, weightMaxG: null })],
      })
      .expect(422);
    expect(overlap.body.code).toBe('validation.failed');
    const outside = await as('logistics')
      .post(`${base}/versions`, {
        effectiveFrom: new Date().toISOString(),
        reason: 'outside (fake)',
        rates: [rate(zoneA.id, { postcode: postcode(3) })],
      })
      .expect(422);
    expect(outside.body.errors[0].path).toBe('rates[0].postcode');
    await as('logistics')
      .post(`${base}/versions`, { effectiveFrom: '2020-01-01T00:00:00+07:00', reason: 'past', rates: [] })
      .expect(422);
  });

  it('applies a version only after C-Level approval, then prices parcels by zone, postcode and band', async () => {
    const base = '/v1/admin/shipping/customer-rate-card';
    const draft = await as('logistics')
      .post(`${base}/versions`, {
        effectiveFrom: new Date().toISOString(),
        reason: 'Q4 rates (fake)',
        rates: [
          rate(zoneA.id),
          rate(zoneA.id, { weightMinG: 5000, weightMaxG: null, priceAmount: '200.00', perExtraKg: '10' }),
          rate(zoneA.id, { postcode: postcode(2), priceAmount: '90.00' }),
          rate(zoneB.id, { priceAmount: '300.00', weightMaxG: null }),
        ],
      })
      .expect(201);
    expect(draft.body).toMatchObject({ status: 'draft', rateCount: 4, schemeCode: 'customer_default' });
    const versionId = draft.body.id as string;

    await as('superadmin').put(`${base}/versions/${versionId}/rates`, { rates: [] }).expect(403);
    await as('logistics')
      .put(`${base}/versions/${versionId}/rates`, {
        rates: (draft.body.rates as object[]).map((r) => ({ ...r, zoneCode: undefined })),
      })
      .expect(200);

    const submitted = await as('logistics')
      .post(`${base}/versions/${versionId}/actions/submit`, {})
      .expect(200);
    expect(submitted.body.status).toBe('proposed');
    await as('logistics').put(`${base}/versions/${versionId}/rates`, { rates: [] }).expect(409);

    // The requester never approves; C-Level does (policy customer_shipping_rate_change).
    await as('logistics')
      .post(`/v1/admin/approvals/${submitted.body.approvalRequestId}/actions/approve`, {})
      .expect((res) => expect([403, 409]).toContain(res.status));
    await as('c-level')
      .post(`/v1/admin/approvals/${submitted.body.approvalRequestId}/actions/approve`, { comment: 'OK' })
      .expect(200);
    await outcome(submitted.body.approvalRequestId as string);

    const version = await as('cs').get(`${base}/versions/${versionId}`).expect(200);
    expect(version.body.status).toBe('approved');
    const card = await as('cs').get(base).expect(200);
    expect(card.body.current.id).toBe(versionId);

    const quote = (body: object) => as('cs').post(`${base}/actions/quote`, body).expect(200);
    expect((await quote({ postcode: postcode(1), weightG: 3200 })).body).toMatchObject({
      priced: true,
      zoneCode: zoneA.code,
      netAmount: '120.00',
    });
    expect((await quote({ postcode: postcode(1), weightG: 7300 })).body.netAmount).toBe('230.00');
    expect((await quote({ postcode: postcode(2), weightG: 100 })).body.netAmount).toBe('90.00');
    expect((await quote({ postcode: postcode(2), weightG: 6000 })).body.netAmount).toBe('210.00');
    expect((await quote({ postcode: postcode(3), weightG: 90_000 })).body.netAmount).toBe('300.00');
    expect((await quote({ postcode: '00001', weightG: 100 })).body).toMatchObject({
      priced: false,
      reason: 'zone_unknown',
    });
    // Frozen once decided.
    await expect(
      prisma.customerShippingRate.updateMany({
        where: { version: { publicId: versionId } },
        data: { priceAmount: '1.00' },
      }),
    ).rejects.toThrow();
  });

  it('exports a version to Excel and keeps drafts editable only by their author', async () => {
    const base = '/v1/admin/shipping/customer-rate-card';
    const card = await as('logistics').get(base).expect(200);
    const copy = await as('logistics')
      .post(`${base}/versions`, {
        effectiveFrom: new Date(Date.now() + 86_400_000).toISOString(),
        reason: 'copy (fake)',
        copyFromVersionId: card.body.current.id,
      })
      .expect(201);
    expect(copy.body.rateCount).toBe(card.body.current.rateCount);
    const file = await as('logistics')
      .post(`${base}/versions/${copy.body.id}/actions/export`, {})
      .expect(200);
    expect(file.body).toMatchObject({ rows: copy.body.rateCount });
    await as('superadmin').delete(`${base}/versions/${copy.body.id}`).expect(403);
    await as('logistics').delete(`${base}/versions/${copy.body.id}`).expect(204);
    await as('logistics').get(`${base}/versions/${copy.body.id}`).expect(404);
  });

  it('imports a draft’s rates from Excel with preview → confirm (A-14)', async () => {
    const base = '/v1/admin/shipping/customer-rate-card';
    const headers = [
      'zone_code',
      'postcode',
      'weight_min_g',
      'weight_max_g',
      'volume_min_cm3',
      'volume_max_cm3',
      'price_amount',
      'per_extra_kg',
    ];
    const row = (zone: string, extra: object = {}) => ({
      zone_code: zone,
      postcode: null,
      weight_min_g: 0,
      weight_max_g: null,
      volume_min_cm3: null,
      volume_max_cm3: null,
      price_amount: '99.00',
      per_extra_kg: null,
      ...extra,
    });
    const draft = await as('logistics')
      .post(`${base}/versions`, {
        effectiveFrom: new Date(Date.now() + 3_600_000).toISOString(),
        reason: 'import (fake)',
      })
      .expect(201);
    const url = `${base}/versions/${draft.body.id}/actions`;

    const bad = await upload([
      { name: 'rates', headers, rows: [row('nope'), row(zoneA.code, { postcode: postcode(3) })] },
    ]);
    const badPreview = await as('logistics').post(`${url}/import-preview`, { fileId: bad }).expect(200);
    expect(badPreview.body).toMatchObject({ canConfirm: false, invalid: 2 });
    expect((badPreview.body.errors as { column: string }[]).map((e) => e.column)).toEqual([
      'zone_code',
      'postcode',
    ]);
    await as('logistics')
      .post(`${url}/import-confirm`, { fileId: bad, previewSha256: badPreview.body.previewSha256 })
      .expect(422);

    const good = await upload([
      { name: 'rates', headers, rows: [row(zoneA.code), row(zoneB.code, { price_amount: '150' })] },
    ]);
    const preview = await as('logistics').post(`${url}/import-preview`, { fileId: good }).expect(200);
    expect(preview.body).toMatchObject({ canConfirm: true, rows: 2, invalid: 0 });
    await as('logistics')
      .post(`${url}/import-confirm`, { fileId: good, previewSha256: '0'.repeat(64) })
      .expect(409);
    const confirmed = await as('logistics')
      .post(`${url}/import-confirm`, { fileId: good, previewSha256: preview.body.previewSha256 })
      .expect(200);
    expect((confirmed.body.rates as { priceAmount: string }[]).map((r) => r.priceAmount).sort()).toEqual([
      '150.00',
      '99.00',
    ]);
    await as('logistics').delete(`${base}/versions/${draft.body.id}`).expect(204);
  });

  it('runs a factory payout card: getpack drafts, the factory counters, getpack settles (D-013, D-042)', async () => {
    const created = await as('partner-manager')
      .post('/v1/admin/factories', {
        legalName: `บริษัท โรงงานขนส่ง ${run} จำกัด`,
        juristicType: 'company',
        taxId: taxId(run * 10 + 3),
        isVatRegistered: true,
        onboardingMode: 'assisted',
      })
      .expect(201);
    const factoryId = created.body.id as string;
    const email = `ship-${run}@factory.example`;
    await as('partner-manager')
      .post(`/v1/admin/factories/${factoryId}/owner-account`, {
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
    const admin = `/v1/admin/factories/${factoryId}/shipping-rate-card`;
    const partner = `/v1/partner/factories/${factoryId}/shipping-rate-card`;

    // Buy prices: Logistics has neither the permission nor D-141 visibility.
    await as('logistics').get(admin).expect(403);
    expect((await as('owner').get(partner).expect(200)).body).toMatchObject({ id: null, current: null });

    const payout = (zoneId: string, over: object = {}) => ({
      zoneId,
      postcode: null,
      weightMinG: 0,
      weightMaxG: null,
      volumeMinCm3: null,
      volumeMaxCm3: null,
      payoutAmount: '95.00',
      perExtraKg: null,
      ...over,
    });
    const draft = await as('partner-manager')
      .post(`${admin}/versions`, {
        effectiveFrom: new Date().toISOString(),
        reason: 'Initial payout card (fake)',
        rates: [payout(zoneA.id), payout(zoneB.id, { payoutAmount: '250.00' })],
      })
      .expect(201);
    expect(draft.body).toMatchObject({ status: 'draft', openLines: 2 });
    await as('partner-manager')
      .post(`${admin}/versions`, { effectiveFrom: new Date().toISOString(), reason: 'second', rates: [] })
      .expect(409);
    // A factory never sees getpack's drafts.
    await as('owner').get(`${partner}/versions/${draft.body.id}`).expect(404);

    const sent = await as('partner-manager')
      .post(`${admin}/versions/${draft.body.id}/actions/send`, {})
      .expect(200);
    expect(sent.body.status).toBe('pending_acceptance');
    const pending = await as('owner').get(`${partner}/versions/${draft.body.id}`).expect(200);
    const [lineA, lineB] = pending.body.rates as { id: string; zoneCode: string }[];
    const byZone = (code: string) => [lineA!, lineB!].find((l) => l.zoneCode === code)!;

    const respond = (body: object) =>
      request(server)
        .post(`${partner}/versions/${draft.body.id}/actions/respond`)
        .auth(tokens['owner']!, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send(body);
    await respond({ lines: [{ rateId: byZone(zoneA.code).id, decision: 'counter' }] }).expect(422);
    const answered = await respond({
      lines: [
        { rateId: byZone(zoneA.code).id, decision: 'accept' },
        { rateId: byZone(zoneB.code).id, decision: 'counter', counterAmount: '270.00', note: 'Fuel (fake)' },
      ],
    }).expect(200);
    expect(answered.body).toMatchObject({ status: 'pending_acceptance', openLines: 1 });

    const suggestions = await as('superadmin')
      .get(`${admin}/versions/${draft.body.id}/suggestions`)
      .expect(200);
    const forA = (
      suggestions.body as { rateId: string; customerNetAmount: string | null; basis: string }[]
    ).find((x) => x.rateId === byZone(zoneA.code).id);
    // The customer card approved above charges 120.00 in zone A; no target margin is set yet.
    expect(forA).toMatchObject({
      customerNetAmount: '120.00',
      basis: 'target_margin_not_set',
      suggestedAmount: null,
    });
    await as('owner')
      .get(`/v1/admin/factories/${factoryId}/shipping-rate-card/versions/${draft.body.id}/suggestions`)
      .expect(403);

    // getpack keeps its value: the line goes back to the factory, which then accepts the rest.
    await as('partner-manager')
      .post(`${admin}/versions/${draft.body.id}/actions/answer-counters`, {
        lines: [{ rateId: byZone(zoneB.code).id, decision: 'keep' }],
      })
      .expect(200);
    await respond({
      lines: [{ rateId: byZone(zoneB.code).id, decision: 'counter', counterAmount: '260.00' }],
    }).expect(200);
    const settled = await as('partner-manager')
      .post(`${admin}/versions/${draft.body.id}/actions/answer-counters`, {
        lines: [{ rateId: byZone(zoneB.code).id, decision: 'accept_counter' }],
      })
      .expect(200);
    expect(settled.body).toMatchObject({ status: 'approved', openLines: 0 });
    expect(settled.body.factoryAcceptedAt).not.toBeNull();
    expect(
      (settled.body.rates as { zoneCode: string; payoutAmount: string }[]).find(
        (r) => r.zoneCode === zoneB.code,
      ),
    ).toMatchObject({ payoutAmount: '260.00' });

    const card = await as('owner').get(partner).expect(200);
    expect(card.body.current.id).toBe(draft.body.id);
    const staffView = await as('partner-manager').get(admin).expect(200);
    expect(staffView.body.current.id).toBe(draft.body.id);
    const audits = await prisma.auditLog.count({
      where: {
        category: 'data_access',
        action: 'price.read_other_factory',
        resourceType: { startsWith: 'factory_shipping_rate_card' },
      },
    });
    expect(audits).toBeGreaterThan(0);
  });

  it('enables a fallback carrier only with a getpack account and stores its callbacks once (D-114)', async () => {
    const base = '/v1/admin/shipping/carriers';
    const list = await as('logistics').get(base).expect(200);
    expect(
      (list.body as { code: string; enabled: boolean }[]).find((c) => c.code === 'flash_express'),
    ).toMatchObject({ enabled: false });
    await as('logistics').post(`${base}/flash_express/actions/enable`, {}).expect(403);
    await as('superadmin').post(`${base}/factory_fleet/actions/disable`, {}).expect(409);
    await as('superadmin')
      .post(`${base}/deliveree/actions/enable`, {})
      .expect((res) => {
        // Deliveree has no account in this suite; Flash may already have one from an earlier run.
        expect([200, 409]).toContain(res.status);
      });
    const account = await as('superadmin')
      .post(`${base}/flash_express/accounts`, {
        label: 'getpack Flash sandbox (fake)',
        credentialsSecretRef: 'getpack/test/flash',
        sandbox: true,
      })
      .expect(201);
    expect(account.body).toMatchObject({ active: true, sandbox: true });
    expect(JSON.stringify(account.body)).not.toContain('getpack/test/flash');
    const enabled = await as('superadmin').post(`${base}/flash_express/actions/enable`, {}).expect(200);
    expect(enabled.body.enabled).toBe(true);
    const quote = await as('superadmin')
      .post(`${base}/flash_express/actions/test-quote`, {
        from: { postcode: '10250' },
        to: { postcode: '50000' },
        parcels: [{ weightG: 3200 }],
      })
      .expect(200);
    expect(quote.body).toMatchObject({ amount: '100.00', currency: 'THB' });

    const hook = (body: object, valid: boolean) =>
      request(server)
        .post('/webhooks/carriers/flash-express')
        .set(valid ? { 'x-fake-carrier-signature': 'valid' } : {})
        .send(body);
    const payload = { ref: `FAKE-${run}`, status: 'in_transit', at: String(run) };
    await hook(payload, false).expect(401);
    await hook(payload, true).expect(200);
    await hook(payload, true).expect(200);
    const rows = await prisma.webhookInbox.findMany({
      where: { provider: 'flash_express', providerEventId: `FAKE-${run}:in_transit:${run}` },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ signatureValid: true, status: 'received' });
    expect(rows[0]!.domainEventId).not.toBeNull();
    await as('superadmin').post(`${base}/flash_express/actions/disable`, {}).expect(200);
  });
});
