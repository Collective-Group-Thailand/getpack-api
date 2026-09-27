import { bangkokDate } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { CapacityService, mondayOf } from '@modules/partners/capacity/capacity.service';
import { ConfigurationService } from '@modules/partners/configuration/configuration.service';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { envelopeFromRow } from '@platform/domain-events/domain-event';
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

/** Factory configuration (B2.2): capability, zones, tiers, pricing mode, capacity, tolerance, agreements, visits. */
describe('partner configuration (e2e, B2.2)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};
  const run = (Date.now() % 1_000_000) + 500_000;
  let factoryId: string;
  let ownerToken: string;
  let productTypeId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    // Bound to IPv4 loopback so a Docker-published port can never shadow the test server.
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    await seedDev(prisma, E2E_DEV_PASSWORD);
    for (const role of ['superadmin', 'partner-manager']) {
      const res = await request(server)
        .post('/v1/auth/staff/login')
        .send({ email: `${role}@example.invalid`, password: E2E_DEV_PASSWORD })
        .expect(200);
      tokens[role] = res.body.accessToken as string;
    }
    const created = await pm()
      .post('/v1/admin/factories', {
        legalName: `บริษัท โรงงานตั้งค่า ${run} จำกัด`,
        juristicType: 'company',
        taxId: taxId(run),
        isVatRegistered: true,
        onboardingMode: 'assisted',
      })
      .expect(201);
    factoryId = created.body.id as string;
    const email = `config-owner-${run}@factory.example`;
    await pm()
      .post(`/v1/admin/factories/${factoryId}/owner-account`, {
        email,
        displayName: 'เจ้าของ',
        initialPassword: E2E_DEV_PASSWORD,
      })
      .expect(201);
    ownerToken = (
      await request(server)
        .post('/v1/auth/partner/login')
        .send({ email, password: E2E_DEV_PASSWORD })
        .expect(200)
    ).body.accessToken as string;
    productTypeId = (await prisma.productType.findUniqueOrThrow({ where: { code: 'folding_carton' } }))
      .publicId;
  });

  afterAll(async () => {
    await app?.close();
  });

  function as(token: string) {
    return {
      get: (url: string) => request(server).get(url).auth(token, { type: 'bearer' }),
      post: (url: string, body: object) =>
        request(server).post(url).auth(token, { type: 'bearer' }).send(body),
      put: (url: string, body: object, etag?: string) => {
        const req = request(server).put(url).auth(token, { type: 'bearer' });
        return (etag ? req.set('If-Match', etag) : req).send(body);
      },
    };
  }
  function pm() {
    return as(tokens['partner-manager']!);
  }
  const url = (path: string) => `/v1/admin/factories/${factoryId}${path}`;
  const outcome = async (approvalId: string) => {
    const event = await prisma.domainEvent.findFirstOrThrow({
      where: { type: 'approval.approved', aggregateId: approvalId },
    });
    await prisma.withTx((tx) => app.get(ConfigurationService).onApprovalOutcome(envelopeFromRow(event), tx));
  };

  it('maps postcodes to zones and records the zones the factory serves (D-013)', async () => {
    const scheme = await pm()
      .post('/v1/admin/shipping/zone-schemes', { code: `e2e_zones_${run}`, name: 'E2E zones' })
      .expect(201);
    const zone = await pm()
      .post('/v1/admin/shipping/zones', {
        schemeId: scheme.body.id,
        code: 'BKK',
        nameTh: 'กรุงเทพ',
        nameEn: 'Bangkok',
      })
      .expect(201);
    const mapped = await pm()
      .put(
        `/v1/admin/shipping/zones/${zone.body.id}/postcodes`,
        { postcodes: ['10100', '10200'] },
        zone.headers['etag'] as string,
      )
      .expect(200);
    expect(mapped.body.postcodes).toEqual(['10100', '10200']);

    const served = await pm()
      .put(url('/delivery-zones'), { zones: [{ zoneId: zone.body.id, extraLeadDays: 1 }] })
      .expect(200);
    expect(served.body).toEqual([
      expect.objectContaining({ zoneCode: 'BKK', serves: true, extraLeadDays: 1 }),
    ]);
    const partner = await as(ownerToken).get(`/v1/partner/factories/${factoryId}/delivery-zones`).expect(200);
    expect(partner.body).toHaveLength(1);
  });

  it('needs a capability before a participation tier (D-043)', async () => {
    const refused = await pm()
      .post(url('/participations'), { productTypeId, tier: 'A', reason: 'Full list' })
      .expect(422);
    expect(refused.body.code).toBe('partners.not_capable');
    await pm()
      .post(url('/capabilities'), { productTypeId, maxSheetWidthMm: 720, maxSheetLengthMm: 1020 })
      .expect(201);
    const tier = await pm()
      .post(url('/participations'), { productTypeId, tier: 'A', reason: 'Full list' })
      .expect(201);
    expect(tier.body).toMatchObject({ versionNo: 1, status: 'approved' });
    await pm()
      .post(url('/participations'), {
        productTypeId,
        tier: 'B',
        reason: 'Back-dated',
        effectiveFrom: '2020-01-01T00:00:00+07:00',
      })
      .expect(422);
  });

  it('chooses the pricing mode at onboarding and changes it only with the Partner Manager’s approval (D-042, D-167)', async () => {
    const first = await pm()
      .post(url('/pricing-arrangement-versions'), {
        ownershipMode: 'factory_price_list',
        reason: 'Onboarding',
      })
      .expect(201);
    expect(first.body.status).toBe('approved');
    // The superadmin asks for the change; the Partner Manager approves it.
    const change = await as(tokens['superadmin']!)
      .post(url('/pricing-arrangement-versions'), {
        ownershipMode: 'platform_rate_card',
        reason: 'Factory prefers our card',
      })
      .expect(201);
    expect(change.body.status).toBe('proposed');
    await as(tokens['superadmin']!)
      .post(url('/pricing-arrangement-versions'), {
        ownershipMode: 'factory_price_list',
        reason: 'Second change',
      })
      .expect(409);
    await pm()
      .post(`/v1/admin/approvals/${change.body.approvalRequestId}/actions/approve`, { comment: 'OK' })
      .expect(200);
    await outcome(change.body.approvalRequestId as string);
    const config = await as(ownerToken).get(`/v1/partner/factories/${factoryId}/configuration`).expect(200);
    expect(config.body.pricingArrangement.current).toMatchObject({
      ownershipMode: 'platform_rate_card',
      versionNo: 2,
    });
    expect(config.body.participations[0].current).toMatchObject({ tier: 'A' });
  });

  it('applies a tolerance override only after Superadmin approval (D-021, D-173)', async () => {
    const proposed = await pm()
      .post(url('/tolerance-versions'), { shortagePct: 3, overagePct: 5, reason: 'Agreed' })
      .expect(201);
    expect(proposed.body.status).toBe('proposed');
    await pm().post(url('/tolerance-versions'), { shortagePct: 101, overagePct: 5, reason: 'x' }).expect(422);
    await as(tokens['superadmin']!)
      .post(`/v1/admin/approvals/${proposed.body.approvalRequestId}/actions/approve`, {})
      .expect(200);
    await outcome(proposed.body.approvalRequestId as string);
    const config = await pm().get(url('/configuration')).expect(200);
    expect(config.body.tolerances[0].current).toMatchObject({ shortagePct: '3.0000', overagePct: '5.0000' });
  });

  it('plans weekly capacity with overrides and bookings, refusing promises beyond it (D-101)', async () => {
    const unconfigured = await app
      .get(CapacityService)
      .nextAvailable(
        (await prisma.factory.findUniqueOrThrow({ where: { publicId: factoryId } })).id,
        (await prisma.productType.findUniqueOrThrow({ where: { publicId: productTypeId } })).id,
        10,
      );
    expect(unconfigured).toEqual({ available: false, reason: 'capacity_not_configured' });

    await pm()
      .post(url('/capacity-versions'), {
        productTypeId,
        capacityUnit: 'sheets',
        weeklyCapacity: 1000,
        reason: 'Agreed',
      })
      .expect(201);
    const today = bangkokDate(new Date());
    const thisWeek = mondayOf(today);
    const nextWeek = new Date(new Date(thisWeek).getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
    await pm()
      .put(url('/capacity-overrides'), {
        productTypeId,
        weekStart: thisWeek,
        capacity: 100,
        reason: 'Maintenance',
      })
      .expect(200);
    await pm()
      .put(url('/capacity-overrides'), { productTypeId, weekStart: '2026-10-13', capacity: 1, reason: 'x' })
      .expect(422);

    const factory = await prisma.factory.findUniqueOrThrow({ where: { publicId: factoryId } });
    const type = await prisma.productType.findUniqueOrThrow({ where: { publicId: productTypeId } });
    // A booking normally comes from an accepted production job (B4.2); this fixture has no job, so the
    // row is written with the job FK switched off for the statement (test only).
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
      await tx.$executeRawUnsafe(
        `INSERT INTO capacity_bookings (factory_id, product_type_id, week_start, production_job_id, load)
         VALUES ($1, $2, $3::date, $4, 900)`,
        factory.id,
        type.id,
        nextWeek,
        BigInt(run),
      );
    });
    const weeks = await pm()
      .get(url(`/capacity?productTypeId=${productTypeId}&weeks=3`))
      .expect(200);
    expect((weeks.body as unknown[]).slice(0, 2)).toEqual([
      expect.objectContaining({ weekStart: thisWeek, capacity: '100.000', source: 'override' }),
      expect.objectContaining({ weekStart: nextWeek, booked: '900.000', free: '100.000' }),
    ]);
    const available = await app.get(CapacityService).nextAvailable(factory.id, type.id, 500);
    expect(available).toMatchObject({
      available: true,
      weekStart: new Date(new Date(nextWeek).getTime() + 7 * 86_400_000).toISOString().slice(0, 10),
    });
    await as(ownerToken)
      .get(`/v1/partner/factories/${factoryId}/capacity?productTypeId=${productTypeId}`)
      .expect(200);
  });

  it('publishes an agreement version and records the factory’s e-acceptance with evidence (D-011)', async () => {
    const published = await pm()
      .post('/v1/admin/agreement-templates/partner_agreement/versions', {
        textTh: `ข้อตกลงทดสอบ ${run}`,
        reason: 'Counsel text',
      })
      .expect(201);
    expect(published.body.versions[0].textSha256).toMatch(/^[0-9a-f]{64}$/);
    const before = await as(ownerToken).get(`/v1/partner/factories/${factoryId}/agreements`).expect(200);
    expect(before.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'partner_agreement', accepted: false })]),
    );
    const accepted = await as(ownerToken)
      .post(`/v1/partner/factories/${factoryId}/agreements/partner_agreement/acceptances`, {})
      .expect(200);
    expect((accepted.body as { key: string }[]).find((a) => a.key === 'partner_agreement')).toMatchObject({
      accepted: true,
      method: 'e_acceptance',
    });
    await as(ownerToken)
      .post(`/v1/partner/factories/${factoryId}/agreements/partner_agreement/acceptances`, {})
      .expect(409);
    const row = await prisma.agreementAcceptance.findFirstOrThrow({
      where: { factory: { publicId: factoryId } },
    });
    expect(row.evidenceSha256).toHaveLength(32);
  });

  it('records a site visit whose pass approves the site_visit step (D-041)', async () => {
    const inspector = await prisma.user.findFirstOrThrow({
      where: { email: 'partner-manager@example.invalid' },
    });
    await pm()
      .post(url('/site-visits'), {
        visitedOn: '2099-01-01',
        checklistVersion: 'v1',
        checklist: {},
        result: 'pass',
        inspectorIds: [inspector.publicId],
      })
      .expect(422);
    const visit = await pm()
      .post(url('/site-visits'), {
        visitedOn: new Date().toISOString().slice(0, 10),
        checklistVersion: 'v1',
        checklist: { machinesOk: true },
        result: 'pass',
        inspectorIds: [inspector.publicId],
      })
      .expect(201);
    expect(visit.body).toMatchObject({ result: 'pass', inspectorIds: [inspector.publicId] });
    const steps = await pm().get(url('/onboarding-steps')).expect(200);
    expect(
      (steps.body as { step: string; status: string }[]).find((s) => s.step === 'site_visit')?.status,
    ).toBe('approved');
  });
});
