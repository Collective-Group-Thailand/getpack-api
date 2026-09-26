import { randomUUID } from 'node:crypto';

import { PrismaService } from '@database/prisma.service';
import { type PriceComponent } from '@generated/prisma/client';
import { FactoriesService } from '@modules/partners/factories/factories.service';
import { PriceComponentRegistry, type PriceValues } from '@modules/partners/pricing/price-component.registry';
import { lineKeyOf } from '@modules/partners/pricing/price-component.registry';
import { PriceListBuilder } from '@modules/partners/pricing/price-list-builder';
import { PriceProposalsService } from '@modules/partners/pricing/price-proposals.service';
import { PriceSimulationsService } from '@modules/partners/pricing/price-simulations.service';
import { PriceSuggestionsService } from '@modules/partners/pricing/price-suggestions.service';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { envelopeFromRow } from '@platform/domain-events/domain-event';
import { SettingsService } from '@platform/settings/settings.service';
import request from 'supertest';

import { seedDev } from '../../prisma/seed/dev-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from '../support/e2e';
import {
  PL_TEST_PRICES,
  PL_TEST_PRICES_SQL,
  PL_TEST_RATES,
  PL_TEST_RATES_SQL,
  TEST_DRIVER_SERIES,
} from '../support/price-test-component';

function taxId(seed: number): string {
  const body = `0000${String(seed).padStart(8, '0')}`;
  const sum = [...body].map(Number).reduce((acc, d, i) => acc + d * (13 - i), 0);
  return `${body}${(11 - (sum % 11)) % 10}`;
}

interface Suggestion {
  lineId: string;
  component: string;
  method: string;
  suggestedValues: { rate: string } | null;
  basis: Record<string, unknown>;
  deviationPct: string | null;
  flags: string[];
}

/** Staff-only suggestions, index series and impact simulation (B2.2, D-040 note, D-044, D-101, D-172). */
describe('price suggestions (e2e, B2.2)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};
  const run = (Date.now() % 1_000_000) + 700_000;
  let seq = 0;
  let productType: { id: bigint; publicId: string };
  let material: { publicId: string };
  let familyId: string;
  let target: { id: string; token: string };
  let proposalId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    // Bound to IPv4 loopback so a Docker-published port can never shadow the test server.
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    await seedDev(prisma, E2E_DEV_PASSWORD);
    for (const sql of [...PL_TEST_PRICES_SQL, ...PL_TEST_RATES_SQL]) await prisma.$executeRawUnsafe(sql);
    app.get(PriceComponentRegistry).unregister(PL_TEST_PRICES.component); // the real folding component, B2.3
    app.get(PriceComponentRegistry).register(PL_TEST_PRICES);
    app.get(PriceComponentRegistry).unregister(PL_TEST_RATES.component); // the real folding component, B2.3
    app.get(PriceComponentRegistry).register(PL_TEST_RATES);
    for (const role of ['superadmin', 'partner-manager']) {
      const res = await request(server)
        .post('/v1/auth/staff/login')
        .send({ email: `${role}@example.invalid`, password: E2E_DEV_PASSWORD })
        .expect(200);
      tokens[role] = res.body.accessToken as string;
    }
    productType = await prisma.productType.findUniqueOrThrow({
      where: { code: 'folding_carton' },
      select: { id: true, publicId: true },
    });
    const family = await prisma.materialFamily.create({
      data: { code: `e2e-art-${run}`, nameTh: 'อาร์ตการ์ด', nameEn: 'Art card', indexUnit: 'THB/kg' },
    });
    familyId = family.publicId;
    material = await prisma.material.create({
      data: { code: `e2e-art-350-${run}`, kind: 'paper', familyId: family.id, nameTh: 'x', nameEn: 'x' },
    });
  });

  afterAll(async () => {
    const registry = app?.get(PriceComponentRegistry);
    registry?.unregister('material_prices');
    registry?.unregister('print_prices');
    await app?.close();
  });

  function as(token: string) {
    const auth = <T extends request.Test>(r: T) => r.auth(token, { type: 'bearer' });
    return {
      get: (url: string) => auth(request(server).get(url)),
      post: (url: string, body: object = {}, etag?: string) => {
        const req = auth(request(server).post(url)).set('Idempotency-Key', randomUUID());
        return (etag ? req.set('If-Match', etag) : req).send(body);
      },
      put: (url: string, body: object) => auth(request(server).put(url)).send(body),
    };
  }
  const pm = () => as(tokens['partner-manager']!);
  const sa = () => as(tokens['superadmin']!);

  /** A factory with tier A for folding cartons in factory-price-list mode; `active` runs the D-041 path. */
  async function factory(active: boolean) {
    const n = ++seq;
    const created = await pm()
      .post('/v1/admin/factories', {
        legalName: `บริษัท โรงงานแนะนำราคา ${run}-${n} จำกัด`,
        juristicType: 'company',
        taxId: taxId(run * 10 + n),
        isVatRegistered: true,
        onboardingMode: 'assisted',
      })
      .expect(201);
    const id = created.body.id as string;
    let etag = created.headers['etag'] as string;
    await pm()
      .post(`/v1/admin/factories/${id}/capabilities`, { productTypeId: productType.publicId })
      .expect(201);
    await pm()
      .post(`/v1/admin/factories/${id}/participations`, {
        productTypeId: productType.publicId,
        tier: 'A',
        reason: 'x',
      })
      .expect(201);
    await pm()
      .post(`/v1/admin/factories/${id}/pricing-arrangement-versions`, {
        ownershipMode: 'factory_price_list',
        reason: 'x',
      })
      .expect(201);
    if (active) {
      for (const action of ['start-review', 'start-trial']) {
        etag = (
          await pm().post(`/v1/admin/factories/${id}/actions/${action}`, { reason: 'ok' }, etag).expect(200)
        ).headers['etag'] as string;
      }
      const row = await prisma.factory.findUniqueOrThrow({ where: { publicId: id } });
      const inspector = await prisma.user.findFirstOrThrow({
        where: { email: 'partner-manager@example.invalid' },
      });
      await prisma.siteVisit.create({
        data: {
          factoryId: row.id,
          visitedOn: new Date(),
          checklistVersion: 'v1',
          checklist: {},
          result: 'pass',
          recordedById: inspector.id,
        },
      });
      const requested = await sa()
        .post(`/v1/admin/factories/${id}/activation-requests`, { reason: 'Trial done' })
        .expect(201);
      const approvalId = requested.body.approvalRequestId as string;
      await pm().post(`/v1/admin/approvals/${approvalId}/actions/approve`, { comment: 'OK' }).expect(200);
      const event = await prisma.domainEvent.findFirstOrThrow({
        where: { type: 'approval.approved', aggregateId: approvalId },
      });
      await prisma.withTx((tx) => app.get(FactoriesService).onActivationOutcome(envelopeFromRow(event), tx));
    }
    return id;
  }

  /** An approved version effective from `from`, built by the real copy-on-write builder. */
  async function seedVersion(
    factoryPublicId: string,
    from: Date,
    lines: { component: PriceComponent; values: PriceValues }[],
  ) {
    const f = await prisma.factory.findUniqueOrThrow({ where: { publicId: factoryPublicId } });
    const builder = app.get(PriceListBuilder);
    const registry = app.get(PriceComponentRegistry);
    await prisma.withTx(async (tx) => {
      const list = await tx.priceList.create({ data: { factoryId: f.id, productTypeId: productType.id } });
      const version = await tx.priceListVersion.create({
        data: {
          priceListId: list.id,
          versionNo: 1,
          origin: 'import',
          effectiveFrom: from,
          reason: 'Seeded (test)',
        },
      });
      const digest = await builder.populate(
        tx,
        version.id,
        null,
        lines.map((l) => ({
          component: l.component,
          action: 'add' as const,
          lineKey: lineKeyOf(registry.get(l.component)!, l.values),
          values: l.values,
        })),
      );
      await tx.priceListVersion.update({
        where: { id: version.id },
        data: { ...digest, status: 'approved', decidedAt: new Date() },
      });
    });
  }

  async function series(code: string, kind: 'material' | 'cost_driver', points: Record<string, string>) {
    const created = await pm()
      .post('/v1/admin/index-series', {
        code,
        kind,
        ...(kind === 'material' && { materialFamilyId: familyId }),
        nameTh: 'ดัชนีทดสอบ',
        nameEn: 'Test index',
        unit: 'index',
      })
      .expect(201);
    for (const [period, value] of Object.entries(points)) {
      await pm()
        .put(`/v1/admin/index-series/${created.body.id}/points/${period}`, { value, sourceRef: 'fake' })
        .expect(200);
    }
    return created.body.id as string;
  }

  const rate = (colours: number, value: string): { component: PriceComponent; values: PriceValues } => ({
    component: 'print_prices',
    values: { colours, rate: value },
  });
  const paper = (value: string): { component: PriceComponent; values: PriceValues } => ({
    component: 'material_prices',
    values: { materialId: material.publicId, qtyFrom: 1000, qtyTo: null, rate: value },
  });
  const approvedIn = new Date('2026-06-15T03:00:00Z');

  it('keeps index series by month and refuses incomplete ones (D-040)', async () => {
    const bad = await pm()
      .post('/v1/admin/index-series', {
        code: 'paper.bad',
        kind: 'material',
        nameTh: 'x',
        nameEn: 'x',
        unit: 'x',
      })
      .expect(422);
    expect(bad.body.errors[0].path).toBe('materialFamilyId');
    const id = await series(`paper.art_${run}`, 'material', { '2026-06': '100', '2026-09': '102' });
    await pm().put(`/v1/admin/index-series/${id}/points/2099-01`, { value: '1' }).expect(422);
    await pm().put(`/v1/admin/index-series/${id}/points/2026-13`, { value: '1' }).expect(422);
    const points = await pm().get(`/v1/admin/index-series/${id}/points?from=2026-01`).expect(200);
    expect((points.body as { period: string }[]).map((p) => p.period)).toEqual(['2026-06', '2026-09']);
    await series(TEST_DRIVER_SERIES, 'cost_driver', { '2026-06': '300', '2026-09': '330' });
    const audits = await prisma.auditLog.count({ where: { action: 'index_series.point_recorded' } });
    expect(audits).toBeGreaterThanOrEqual(4);
  });

  it('suggests index-linked materials and the lower of own history × driver and the peer P75 (D-040, D-101)', async () => {
    target = { id: await factory(false), token: '' };
    await seedVersion(target.id, approvedIn, [paper('12.5'), rate(4, '2.0')]);
    for (const peerRate of ['1.8', '2.0', '2.6']) {
      await seedVersion(await factory(true), approvedIn, [rate(4, peerRate)]);
    }
    // One more active factory without this line must not count as a peer sample.
    await seedVersion(await factory(true), approvedIn, [rate(6, '9')]);

    const draft = await sa()
      .post(`/v1/admin/factories/${target.id}/price-proposals`, { productTypeId: productType.publicId })
      .expect(201);
    proposalId = draft.body.id as string;
    await sa()
      .put(`/v1/admin/price-proposals/${proposalId}/lines`, {
        lines: [
          { ...paper('13'), action: 'change' },
          { ...rate(4, '2.4'), action: 'change' },
        ],
      })
      .expect(200);
    await sa().post(`/v1/admin/price-proposals/${proposalId}/actions/submit`).expect(200);
    // The worker computes suggestions on `price_proposal.submitted`.
    const submitted = await prisma.domainEvent.findFirstOrThrow({
      where: { type: 'price_proposal.submitted', aggregateId: proposalId },
    });
    await prisma.withTx((tx) => app.get(PriceSuggestionsService).onSubmitted(envelopeFromRow(submitted), tx));

    const res = await pm().get(`/v1/admin/price-proposals/${proposalId}/suggestions`).expect(200);
    const byComponent = new Map((res.body.lines as Suggestion[]).map((l) => [l.component, l]));
    const materials = byComponent.get('material_prices')!;
    expect(materials).toMatchObject({
      method: 'material_index',
      suggestedValues: expect.objectContaining({ rate: '12.750000' }),
      deviationPct: '1.9608',
      flags: [],
    });
    expect(materials.basis['index']).toMatchObject({
      then: { period: '2026-06' },
      now: { period: '2026-09' },
      ratio: '1.02',
    });

    const print = byComponent.get('print_prices')!;
    expect(print).toMatchObject({
      method: 'own_history_driver',
      suggestedValues: expect.objectContaining({ rate: '2.200000' }),
      deviationPct: '9.0909',
    });
    expect(print.basis['peers']).toEqual({
      count: 3,
      columns: { rate: { p25: '1.900000', median: '2.000000', p75: '2.300000' } },
    });
    // No identities of other factories anywhere in the basis (D-044).
    expect(JSON.stringify(res.body)).not.toMatch(/factory|E2E|โรงงาน/i);
    // The band is unset (D-172): deviations are shown, never flagged.
    expect(print.flags).not.toContain('above_band');
    expect(
      await prisma.auditLog.count({
        where: { action: 'price.suggestions_read', resourcePublicId: proposalId },
      }),
    ).toBe(1);
  });

  it('flags deviations above the band only once a superadmin has set it (D-172)', async () => {
    const setting = await prisma.setting.findFirstOrThrow({
      where: { key: 'partners.suggestion_deviation_band_pct' },
    });
    const superadmin = await prisma.user.findFirstOrThrow({ where: { email: 'superadmin@example.invalid' } });
    await prisma.settingVersion.create({
      data: {
        settingId: setting.id,
        versionNo: 1,
        value: '5',
        effectiveFrom: new Date(Date.now() - 60_000),
        status: 'approved',
        reason: 'Band agreed (test)',
        decidedAt: new Date(),
        createdById: superadmin.id,
      },
    });
    app.get(SettingsService).invalidate('partners.suggestion_deviation_band_pct');
    try {
      const res = await pm()
        .post(`/v1/admin/price-proposals/${proposalId}/suggestions/actions/recompute`)
        .expect(200);
      const flags = new Map((res.body.lines as Suggestion[]).map((l) => [l.component, l.flags]));
      expect(flags.get('print_prices')).toContain('above_band');
      expect(flags.get('material_prices')).not.toContain('above_band');
    } finally {
      // Test-only: approved versions are immutable, so the trigger is bypassed to restore "unset".
      await prisma.$executeRawUnsafe('ALTER TABLE setting_versions DISABLE TRIGGER USER');
      await prisma.$executeRawUnsafe('DELETE FROM setting_versions WHERE setting_id = $1', setting.id);
      await prisma.$executeRawUnsafe('ALTER TABLE setting_versions ENABLE TRIGGER USER');
      app.get(SettingsService).invalidate('partners.suggestion_deviation_band_pct');
    }
  });

  it('never shows suggestions to the factory (D-044)', async () => {
    const detail = await pm().get(`/v1/admin/price-proposals/${proposalId}`).expect(200);
    expect(JSON.stringify(detail.body)).not.toMatch(/suggest|benchmark|p75/i);
    const email = `sugg-owner-${run}@factory.example`;
    await pm()
      .post(`/v1/admin/factories/${target.id}/owner-account`, {
        email,
        displayName: 'เจ้าของ',
        initialPassword: E2E_DEV_PASSWORD,
      })
      .expect(201);
    target.token = (
      await request(server)
        .post('/v1/auth/partner/login')
        .send({ email, password: E2E_DEV_PASSWORD })
        .expect(200)
    ).body.accessToken as string;
    // The factory has no suggestions route and no staff route.
    await as(target.token)
      .get(`/v1/partner/factories/${target.id}/price-proposals/${proposalId}/suggestions`)
      .expect(404);
    await as(target.token).get(`/v1/admin/price-proposals/${proposalId}/suggestions`).expect(403);
  });

  it('runs an impact simulation in the worker: 202, then poll (D-040 note)', async () => {
    const queued = await pm().post(`/v1/admin/price-proposals/${proposalId}/simulations`).expect(202);
    expect(queued.body.status).toBe('queued');
    expect(await app.get(PriceSimulationsService).processDue()).toBeGreaterThanOrEqual(1);
    const done = await pm()
      .get(`/v1/admin/price-proposals/${proposalId}/simulations/${queued.body.id}`)
      .expect(200);
    expect(done.body).toMatchObject({ status: 'succeeded', result: { quotesInWindow: 0 } });
    const days =
      (new Date(done.body.windowTo as string).getTime() -
        new Date(done.body.windowFrom as string).getTime()) /
      86_400_000;
    expect(Math.round(days)).toBe(90);
  });

  it('builds versions from the proposal without touching the peers (copy-on-write)', async () => {
    const detail = await pm().get(`/v1/admin/price-proposals/${proposalId}`).expect(200);
    await pm()
      .post(`/v1/admin/price-proposals/${proposalId}/actions/decide`, {
        lines: (detail.body.lines as { id: string }[]).map((l) => ({ lineId: l.id, decision: 'accept' })),
      })
      .expect(200);
    const approvalId = detail.body.approvalRequestId as string;
    await pm().post(`/v1/admin/approvals/${approvalId}/actions/approve`, { comment: 'OK' }).expect(200);
    const event = await prisma.domainEvent.findFirstOrThrow({
      where: { type: 'approval.approved', aggregateId: approvalId },
    });
    await prisma.withTx((tx) => app.get(PriceProposalsService).onApprovalOutcome(envelopeFromRow(event), tx));
    const after = await pm().get(`/v1/admin/price-proposals/${proposalId}`).expect(200);
    // Staff-entered for a factory in its own-list mode: assisted entry, awaiting sign-off.
    expect(after.body.resultingVersion).toMatchObject({ versionNo: 2, status: 'pending_acceptance' });
  });
});
