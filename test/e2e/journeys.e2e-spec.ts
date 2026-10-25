import { randomUUID } from 'node:crypto';

import { OBJECT_STORAGE } from '@collective/integrations/storage';
import { type FakeObjectStorage } from '@integrations/storage/fake-object-storage';
import { JourneysService } from '@modules/analytics/journeys.service';
import { AnalyticsRollupService } from '@modules/analytics/rollups.service';
import ExcelJS from 'exceljs';

import { as, bootCommerceApp, type CommerceApp, staffToken } from '../support/commerce-e2e';

/**
 * U5.B6 scorecard journeys (D-303): consented web events → nightly journey facts → funnels per journey, the Monday
 * week-over-week check alerting ops, and the anonymised export. Works on January 2026 so the BFF-event suites (which
 * own "today") are not disturbed.
 */
describe('scorecard journeys (e2e, U5.B6)', () => {
  let ctx: CommerceApp;
  let admin: string;

  /** `n` consented sessions on `day` (noon Bangkok) reaching the first `reach[i]` steps of a journey_step journey. */
  async function sessions(day: string, journey: string, steps: string[], reach: number[]) {
    for (let s = 0; s < Math.max(...reach); s++) {
      const session = randomUUID();
      for (const [i, step] of steps.entries()) {
        if (s >= reach[i]!) break;
        await ctx.prisma.$executeRaw`
          INSERT INTO analytics.raw_events (event_id, occurred_at, source, event_name, anonymous_id, session_id,
            consent_state, properties)
          VALUES (${randomUUID()}::uuid, ${new Date(`${day}T05:00:00Z`)}, 'bff', 'journey_step', ${randomUUID()},
            ${session}, 'granted', ${JSON.stringify({ journey, step })}::jsonb)`;
      }
    }
  }

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    admin = await staffToken(ctx, 'admin');
    // Week of 2026-01-05: claim 40 → 30 → 20 (50 %); week of 2026-01-12: 40 → 20 → 10 (25 %): a 50 % drop.
    await sessions('2026-01-07', 'claim', ['started', 'evidence_added', 'submitted'], [40, 30, 20]);
    await sessions('2026-01-14', 'claim', ['started', 'evidence_added', 'submitted'], [40, 20, 10]);
    // Dieline: a drop too, on 2 sessions only — below the minimum, no alert.
    await sessions('2026-01-07', 'dieline', ['opened', 'size_entered', 'downloaded'], [2, 2, 2]);
    await sessions('2026-01-14', 'dieline', ['opened', 'size_entered', 'downloaded'], [2, 1, 0]);
    // A refused-consent hit never counts (no session).
    await ctx.prisma.$executeRaw`
      INSERT INTO analytics.raw_events (event_id, occurred_at, source, event_name, consent_state, properties)
      VALUES (${randomUUID()}::uuid, ${new Date('2026-01-07T05:00:00Z')}, 'bff', 'journey_step', 'denied',
        ${JSON.stringify({ journey: 'claim', step: 'started' })}::jsonb)`;
    const rollups = ctx.app.get(AnalyticsRollupService);
    await rollups.runDay('2026-01-07');
    await rollups.runDay('2026-01-14');
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('turns the day’s consented events into journey funnels (D-303)', async () => {
    const report = (
      await as(ctx, admin)
        .get('/v1/admin/analytics/journeys')
        .query({ from: '2026-01-05', to: '2026-01-11' })
        .expect(200)
    ).body as {
      journeys: { journey: string; task: string; steps: { sessions: number }[]; conversionPct: string }[];
    };
    const claim = report.journeys.find((j) => j.journey === 'claim')!;
    expect(claim).toMatchObject({ task: 'T9', conversionPct: '50.00' });
    expect(claim.steps.map((s) => s.sessions)).toEqual([40, 30, 20]);
    expect(report.journeys.map((j) => j.journey)).toContain('studio');
    await as(ctx, await staffToken(ctx, 'cs'))
      .get('/v1/admin/analytics/journeys')
      .query({ from: '2026-01-05', to: '2026-01-11' })
      .expect(403);
    await as(ctx, admin)
      .get('/v1/admin/analytics/journeys')
      .query({ from: '2026-01-11', to: '2026-01-05' })
      .expect(422);
  });

  it('alerts ops once when a journey’s conversion fell more than 15 % week over week (D-303)', async () => {
    const journeys = ctx.app.get(JourneysService);
    // The Monday job checks the week before (2026-01-12 … 18) against the one before it.
    expect(await journeys.weeklyCheck(new Date('2026-01-19T03:00:00Z'))).toBe(1);
    const checks = (
      await as(ctx, admin)
        .get('/v1/admin/analytics/journeys')
        .query({ from: '2026-01-12', to: '2026-01-18' })
        .expect(200)
    ).body.weekChecks as { journey: string; alert: boolean; dropPct: string | null; weekStart: string }[];
    expect(checks.find((c) => c.journey === 'claim')).toMatchObject({
      weekStart: '2026-01-12',
      alert: true,
      dropPct: '50.00',
    });
    expect(checks.find((c) => c.journey === 'dieline')).toMatchObject({ alert: false });
    const alerts = await ctx.prisma.domainEvent.findMany({
      where: { type: 'ops.alert_raised', payload: { path: ['signal'], equals: 'journey_conversion_drops' } },
    });
    expect(alerts).toHaveLength(1);
    expect(String((alerts[0]!.payload as { description: string }).description)).toContain('claim');

    const signals = (await as(ctx, admin).get('/v1/admin/ops/signals').expect(200)).body as {
      key: string;
      value: number;
      status: string;
    }[];
    expect(signals.find((s) => s.key === 'journey_conversion_drops')).toMatchObject({
      value: 1,
      status: 'alert',
    });
  });

  it('exports aggregates for a scorecard round, small cells suppressed (D-303, D-160)', async () => {
    const res = await as(ctx, admin)
      .post('/v1/admin/analytics/journeys/actions/export', {
        from: '2026-01-05',
        to: '2026-01-18',
        format: 'xlsx',
      })
      .expect(200);
    const file = await ctx.prisma.fileObject.findUniqueOrThrow({
      where: { publicId: res.body.fileId as string },
    });
    const stored = ctx.app.get<FakeObjectStorage>(OBJECT_STORAGE).objects.get(file.storageKey)!;
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(stored.body as unknown as ArrayBuffer);
    const values = book.worksheets[0]!.getSheetValues().map((r) => (Array.isArray(r) ? r.slice(1) : []));
    const text = JSON.stringify(values);
    expect(text).toContain('claim');
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/); // no session or visitor ids
    // The dieline cells of 2 sessions are suppressed (k = 3).
    const dieline = values.filter((r) => r.includes('dieline') && r.includes('opened'));
    expect(dieline.length).toBeGreaterThan(0);
    for (const row of dieline) expect(row).toContain(true);
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'export.generated', resourceType: 'journey_steps' },
      }),
    ).toBe(1);
  });
});
