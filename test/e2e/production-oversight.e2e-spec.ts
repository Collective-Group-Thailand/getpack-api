import { randomUUID } from 'node:crypto';

import { bangkokDate } from '@common/time/bangkok';
import { ProductionOversightService } from '@modules/production/production-oversight.service';

import { SETTINGS } from '../../prisma/seed/data/settings';
import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  as,
  customerToken,
  foldingBackToRfq,
  foldingReady,
  placeOrder,
  postcodes,
  seedShipping,
  setFlag,
  setSetting,
  staffToken,
} from '../support/commerce-e2e';
import {
  approveArtwork,
  bootFulfilmentApp,
  factoryToken,
  type FulfilmentApp,
  payDue,
} from '../support/fulfilment-e2e';

const SAMPLING = SETTINGS.find((s) => s.key === 'qc.inspection_sampling')!.value as Record<string, unknown>;

/** Inspections (D-076), the SLA engine and the scorecard (D-155) — B4.2. */
describe('production oversight (e2e, B4.2)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let code: string;
  let owner: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    [code] = postcodes(ctx, 1) as [string];
    await seedShipping(ctx, fixture.factoryPublicId, [code]);
    await setFlag(ctx, 'payments.scb', true);
    owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 21);
  });

  afterAll(async () => {
    await setSetting(ctx, 'qc.inspection_sampling', SAMPLING);
    await setFlag(ctx, 'payments.scb', false);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  async function releasedJob(n: number) {
    const { token } = await customerToken(ctx, n);
    const prepress = await staffToken(ctx, 'prepress');
    const group = await placeOrder(ctx, token, fixture, code);
    const orderId = group.orders[0]!.id;
    await payDue(ctx, token, group.id);
    await approveArtwork(ctx, token, prepress, orderId);
    await ctx.pump();
    return ctx.prisma.productionJob.findFirstOrThrow({ where: { order: { publicId: orderId } } });
  }

  it('plans an inspection from the risk rules and records pass / fail on the ISO acceptance numbers', async () => {
    // Every order value now triggers 100 % inspection (test setting).
    await setSetting(ctx, 'qc.inspection_sampling', { ...SAMPLING, fullInspectionFromValue: '1.00' });
    const job = await releasedJob(1);
    await ctx.pump();
    const partnerManager = await staffToken(ctx, 'partner_manager');
    const list = await as(ctx, partnerManager)
      .get('/v1/admin/inspections?status=planned&perPage=100')
      .expect(200);
    const inspection = (
      list.body.data as {
        id: string;
        jobId: string;
        reasons: string[];
        sampleSize: number;
        accept: Record<string, number>;
      }[]
    ).find((i) => i.jobId === job.publicId)!;
    expect(inspection).toMatchObject({
      reasons: expect.arrayContaining(['value_100_pct']),
      sampleSize: 80,
      accept: { critical: 0, major: 5, minor: 7 },
    });
    expect(
      (await as(ctx, owner).get(`/v1/partner/production-jobs/${job.publicId}`).expect(200)).body
        .inspectionRequired,
    ).toBe(true);

    const cs = await staffToken(ctx, 'cs');
    await as(ctx, cs)
      .post(`/v1/admin/inspections/${inspection.id}/actions/record`, {
        foundCritical: 0,
        foundMajor: 0,
        foundMinor: 0,
      })
      .expect(403);
    await as(ctx, partnerManager)
      .post(`/v1/admin/inspections/${inspection.id}/actions/schedule`, {
        scheduledAt: '2026-10-08T10:00:00+07:00',
      })
      .expect(200);
    await as(ctx, owner)
      .post(`/v1/partner/production-jobs/${job.publicId}/actions/accept`)
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    const failed = await as(ctx, partnerManager)
      .post(`/v1/admin/inspections/${inspection.id}/actions/record`, {
        foundCritical: 0,
        foundMajor: 6,
        foundMinor: 0,
      })
      .expect(200);
    expect(failed.body).toMatchObject({ status: 'failed', found: { major: 6 } });
    expect(
      (await as(ctx, partnerManager).get(`/v1/admin/production-jobs/${job.publicId}`).expect(200)).body,
    ).toMatchObject({ status: 'on_hold', holdReason: 'getpack inspection failed (D-076)' });
    await as(ctx, partnerManager)
      .post(`/v1/admin/inspections/${inspection.id}/actions/record`, {
        foundCritical: 0,
        foundMajor: 0,
        foundMinor: 0,
      })
      .expect(409);

    const second = await releasedJob(2);
    await ctx.pump();
    const next = (
      (await as(ctx, partnerManager).get('/v1/admin/inspections?status=planned&perPage=100').expect(200)).body
        .data as { id: string; jobId: string }[]
    ).find((i) => i.jobId === second.publicId)!;
    const passed = await as(ctx, partnerManager)
      .post(`/v1/admin/inspections/${next.id}/actions/record`, {
        foundCritical: 0,
        foundMajor: 5,
        foundMinor: 7,
      })
      .expect(200);
    expect(passed.body.status).toBe('passed');
  });

  it('flags jobs at risk once, sends the factory digest and computes the monthly scorecard', async () => {
    await setSetting(ctx, 'qc.inspection_sampling', SAMPLING);
    const job = await releasedJob(3);
    await as(ctx, owner)
      .post(`/v1/partner/production-jobs/${job.publicId}/actions/accept`)
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    // The first open step (acceptance completed job_received, ca63113) is two days late and the plan ends on
    // the promised date → at risk.
    const first = await ctx.prisma.jobMilestone.findFirstOrThrow({
      where: { jobId: job.id, status: { not: 'completed' } },
      orderBy: { seq: 'asc' },
    });
    await ctx.prisma.jobMilestone.update({
      where: { id: first.id },
      data: { dueAt: new Date(Date.now() - 2 * 86_400_000) },
    });
    const oversight = ctx.app.get(ProductionOversightService);
    expect(await oversight.evaluateSla()).toBeGreaterThanOrEqual(1);
    await oversight.evaluateSla();
    expect(
      await ctx.prisma.domainEvent.count({
        where: { type: 'production_job.at_risk', aggregateId: job.publicId },
      }),
    ).toBe(1);
    const lead = await staffToken(ctx, 'cs_lead');
    const risky = await as(ctx, lead).get('/v1/admin/production-jobs?queue=at_risk&perPage=100').expect(200);
    expect((risky.body.data as { id: string }[]).some((j) => j.id === job.publicId)).toBe(true);

    expect(await oversight.dailyDigest()).toBeGreaterThanOrEqual(1);
    const digest = await ctx.prisma.domainEvent.findFirst({
      where: { type: 'factory.daily_digest', aggregateId: fixture.factoryPublicId },
      orderBy: { occurredAt: 'desc' },
    });
    expect(digest?.payload).toMatchObject({ overdueSteps: expect.any(Number) });

    // Scorecards are per Bangkok month (the UTC date lags by 7 hours on the 1st).
    const month = bangkokDate(new Date()).slice(0, 8) + '01';
    const recomputed = await as(ctx, lead)
      .post(`/v1/admin/factories/${fixture.factoryPublicId}/scorecards/actions/recompute`, { month })
      .expect(200);
    expect(recomputed.body.jobsCount).toBeGreaterThanOrEqual(1);
    expect(recomputed.body.onTimeAcceptancePct).not.toBeNull();
    const mine = await as(ctx, owner)
      .get(`/v1/partner/factories/${fixture.factoryPublicId}/scorecards`)
      .expect(200);
    expect((mine.body as { month: string }[]).some((s) => s.month === month)).toBe(true);
    const operator = await factoryToken(ctx, fixture.factoryPublicId, 'factory_operator', 22);
    await as(ctx, operator).get(`/v1/partner/factories/${fixture.factoryPublicId}/scorecards`).expect(403);
    // U-B0.2: every factory's scorecard of the month, the board, filters and job extras.
    const all = await as(ctx, lead)
      .get(`/v1/admin/scorecards?month=${month.slice(0, 7)}`)
      .expect(200);
    expect(all.body).toContainEqual(
      expect.objectContaining({ month, factory: expect.objectContaining({ id: fixture.factoryPublicId }) }),
    );
    await as(ctx, lead).get('/v1/admin/scorecards?month=2026-13').expect(422);
    const board = (
      await as(ctx, lead).get(`/v1/admin/production-board?factoryId=${fixture.factoryPublicId}`).expect(200)
    ).body as {
      columns: { key: string; total: number; atRisk: number }[];
      total: number;
      atRisk: number;
    };
    expect(board.columns.reduce((a, c) => a + c.total, 0)).toBe(board.total);
    expect(board.atRisk).toBeGreaterThanOrEqual(1);
    const listed = await as(ctx, lead)
      .get(`/v1/admin/production-jobs?factoryId=${fixture.factoryPublicId}&perPage=100`)
      .expect(200);
    const riskyJob = (
      listed.body.data as { atRisk: boolean; riskReason: string | null; productTypeCode: string }[]
    ).find((j) => j.atRisk)!;
    expect(riskyJob).toMatchObject({
      riskReason: expect.stringMatching(/^(step_overdue|late_plan)$/),
      productTypeCode: expect.any(String),
    });
    const inspections = await as(ctx, lead)
      .get(`/v1/admin/inspections?factoryId=${fixture.factoryPublicId}&perPage=100`)
      .expect(200);
    expect(inspections.body.data[0]).toMatchObject({
      aql: { critical: expect.any(String), major: expect.any(String), minor: expect.any(String) },
      orderId: expect.any(String),
      productTypeCode: expect.any(String),
    });
  });
});
