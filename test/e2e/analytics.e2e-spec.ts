import { randomUUID } from 'node:crypto';

import { MoneyDecimal } from '@common/money/money';
import { addCalendarDays, bangkokDate, startOfBangkokDay } from '@common/time/bangkok';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { ProspectusService } from '@modules/analytics/prospectus.service';
import { AnalyticsRollupService } from '@modules/analytics/rollups.service';
import { readObject } from '@modules/payouts/read-object';
import ExcelJS from 'exceljs';
import request from 'supertest';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  addAddress,
  as,
  customerToken,
  devGeo,
  foldingBackToRfq,
  foldingReady,
  postcodes,
  saveQuote,
  seedShipping,
  setFlag,
  staffToken,
} from '../support/commerce-e2e';
import { approveArtwork, bootFulfilmentApp, type FulfilmentApp, payDue } from '../support/fulfilment-e2e';

interface FunnelStep {
  step: string;
  sessions: number;
}

/**
 * B6.1 demand & growth analytics: BFF events with consent mode (no identifier without consent, banded
 * quantities, cleaned paths, replay-safe), a real paid order, the nightly rollup, dashboards that reconcile to
 * the source tables, idempotent re-runs and backfills, permissions, and the k-anonymous partner prospectus.
 */
describe('analytics (e2e, B6.1)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let marketing: string;
  let partnerManager: string;
  let admin: string;
  let customer: { token: string; phone: string };
  let groupId: string;
  const today = bangkokDate(new Date());
  const range = `from=${today}&to=${today}`;
  const visitor = () => `v${randomUUID().replaceAll('-', '').slice(0, 20)}`;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    await seedShipping(ctx, fixture.factoryPublicId, postcodes(ctx, 1));
    await setFlag(ctx, 'payments.scb', true);
    [marketing, partnerManager, admin] = await Promise.all([
      staffToken(ctx, 'marketing'),
      staffToken(ctx, 'partner_manager'),
      staffToken(ctx, 'admin'),
    ]);
    // The analytics-cookie text in force (legal content is entered by admins, never seeded — D-005).
    await as(ctx, await staffToken(ctx, 'superadmin'))
      .post('/v1/admin/consent-purposes/analytics_cookies/versions', {
        textTh: 'ยินยอมให้ใช้คุกกี้เพื่อการวิเคราะห์ (ทดสอบ)',
        textEn: 'Analytics cookies (test text)',
        effectiveFrom: new Date().toISOString(),
        reason: 'e2e analytics',
      })
      .expect(201);

    // A real paid order group of a signed-in customer.
    customer = await customerToken(ctx, 1);
    const address = await addAddress(ctx, customer.token, postcodes(ctx, 1)[0]!);
    const quote = await saveQuote(ctx, customer.token, fixture, [1000]);
    await as(ctx, customer.token)
      .post('/v1/store/cart/items', {
        quoteId: quote.id,
        quoteOptionId: quote.options[0]!.id,
        designOption: 'own_file',
        destinations: [{ addressId: address.id, quantity: 1000 }],
      })
      .expect(201);
    const group = (
      await as(ctx, customer.token)
        .post('/v1/store/checkout', {})
        .set('Idempotency-Key', randomUUID())
        .expect(201)
    ).body as { id: string; orders: { id: string }[] };
    groupId = group.id;
    await payDue(ctx, customer.token, groupId);
    // Paid and approved: production is released automatically (D-073) — a job of the dev factory today.
    await approveArtwork(ctx, customer.token, await staffToken(ctx, 'prepress'), group.orders[0]!.id);
    await ctx.pump();
  });

  afterAll(async () => {
    await setFlag(ctx, 'payments.scb', false);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  const ingest = (events: object[], token?: string) => {
    const req = request(ctx.server).post('/v1/store/analytics/events');
    return (token ? req.auth(token, { type: 'bearer' }) : req).send({ events });
  };
  const event = (anonymousId: string, sessionId: string, name: string, extra: object = {}) => ({
    eventId: randomUUID(),
    name,
    occurredAt: new Date().toISOString(),
    anonymousId,
    sessionId,
    deviceClass: 'mobile',
    utm: { source: 'Facebook', medium: 'cpc', campaign: `e2e_${ctx.run}` },
    ...extra,
  });
  const raw = (anonymousOrEvent: { eventId?: string }) =>
    ctx.prisma.$queryRaw<
      Record<string, unknown>[]
    >`SELECT * FROM analytics.raw_events WHERE event_id = ${anonymousOrEvent.eventId}::uuid`;

  it('keeps identifiers only with consent, bands quantities, cleans paths and ignores replays', async () => {
    const { postcode } = await devGeo(ctx.prisma);
    const a = visitor();
    const sessionA = `s-${randomUUID().slice(0, 12)}`;
    await as(ctx, customer.token)
      .post('/v1/store/analytics/consent', { anonymousId: a, granted: true })
      .expect(200);
    const journey = [
      event(a, sessionA, 'page_view', {
        pagePath: `/configure/folding_carton?phone=${customer.phone}`,
        productTypeCode: 'folding_carton',
        postcode,
        properties: { pageType: 'configurator' },
      }),
      event(a, sessionA, 'configurator_step', {
        productTypeCode: 'folding_carton',
        properties: { step: 'material', stepIndex: 2 },
      }),
      event(a, sessionA, 'quote_shown', {
        productTypeCode: 'folding_carton',
        properties: { quantity: 1000, instant: true, leadTimeDays: 10, unitPrice: '4.250000' },
      }),
      event(a, sessionA, 'add_to_cart', {
        productTypeCode: 'folding_carton',
        properties: { quantity: 1000 },
      }),
      event(a, sessionA, 'checkout_step', { properties: { step: 'started' } }),
      event(a, sessionA, 'checkout_step', {
        pagePath: `/orders/${groupId}`,
        properties: { step: 'placed', orderGroupId: groupId },
      }),
    ];
    expect((await ingest(journey, customer.token).expect(202)).body).toEqual({
      accepted: 6,
      duplicates: 0,
      dropped: 0,
    });
    const [shown] = await raw(journey[2]!);
    expect(shown).toMatchObject({
      consent_state: 'granted',
      anonymous_id: a,
      session_id: sessionA,
      properties: { quantityBand: '1000-4999', instant: true, leadTimeDays: 10, unitPrice: '4.250000' },
    });
    const me = await ctx.prisma.user.findFirstOrThrow({ where: { phone: customer.phone } });
    expect(shown!['user_public_id']).toBe(me.publicId);
    const [view] = await raw(journey[0]!);
    expect(view).toMatchObject({
      page_path: '/configure/folding_carton',
      province_code: 'DEV1',
      utm: { source: 'facebook', medium: 'cpc', campaign: `e2e_${ctx.run}` },
    });
    expect((await raw(journey[5]!))[0]!['page_path']).toBe('/orders/:id');

    // No consent: an anonymous visitor's hit keeps no identifier (and no province).
    const b = event(visitor(), 's-nobody-0001', 'page_view', { postcode, pagePath: '/' });
    await ingest([b]).expect(202);
    expect((await raw(b))[0]).toMatchObject({
      consent_state: 'denied',
      anonymous_id: null,
      session_id: null,
      user_public_id: null,
      province_code: null,
      page_path: '/',
    });

    // Consent given then withdrawn: the latest record wins.
    const c = visitor();
    await request(ctx.server)
      .post('/v1/store/analytics/consent')
      .send({ anonymousId: c, granted: true })
      .expect(200);
    await request(ctx.server)
      .post('/v1/store/analytics/consent')
      .send({ anonymousId: c, granted: false })
      .expect(200);
    const cEvent = event(c, 's-withdrawn-01', 'page_view');
    await ingest([cEvent]).expect(202);
    expect((await raw(cEvent))[0]).toMatchObject({ consent_state: 'denied', anonymous_id: null });

    // Replays are ignored, stale events dropped, free text refused.
    expect((await ingest([journey[0]!], customer.token).expect(202)).body).toEqual({
      accepted: 0,
      duplicates: 1,
      dropped: 0,
    });
    const stale = event(a, sessionA, 'page_view', {
      occurredAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
    });
    expect((await ingest([stale]).expect(202)).body).toEqual({ accepted: 0, duplicates: 0, dropped: 1 });
    const invalid = await ingest([
      event(a, sessionA, 'page_view', { properties: { email: 'someone@example.invalid' } }),
    ]).expect(422);
    expect(invalid.body.errors[0].path).toBe('events[0].properties');
    const consents = await ctx.prisma.consentRecord.count({ where: { anonymousId: { in: [a, c] } } });
    expect(consents).toBe(3);
  });

  it('rolls the day up and the dashboards reconcile to the source tables', async () => {
    await ctx.app.get(AnalyticsRollupService).runDay(today);
    const runs = await ctx.prisma.$queryRaw<
      { job: string; status: string }[]
    >`SELECT job, status FROM analytics.rollup_runs WHERE for_date = ${today}::date`;
    expect(runs).toHaveLength(12);
    expect(runs.every((r) => r.status === 'succeeded')).toBe(true);

    // Funnel: only this suite posts BFF events, so the consented session is the whole funnel.
    const funnel = (await as(ctx, marketing).get(`/v1/admin/analytics/funnel?${range}`).expect(200)).body as {
      steps: FunnelStep[];
    };
    expect(Object.fromEntries(funnel.steps.map((s) => [s.step, s.sessions]))).toEqual({
      visit: 1,
      configure: 1,
      quote: 1,
      cart: 1,
      checkout: 1,
      placed: 1,
      paid: 1,
    });
    const folding = await ctx.prisma.productType.findUniqueOrThrow({ where: { code: 'folding_carton' } });
    const byType = (
      await as(ctx, marketing)
        .get(`/v1/admin/analytics/funnel?${range}&productTypeId=${folding.publicId}`)
        .expect(200)
    ).body as { steps: FunnelStep[]; productType: { code: string } };
    expect(byType.productType.code).toBe('folding_carton');
    expect(byType.steps.at(-1)).toMatchObject({ step: 'paid', sessions: 1, fromPreviousPct: '100.00' });

    const traffic = (await as(ctx, marketing).get(`/v1/admin/analytics/traffic?${range}`).expect(200)).body;
    expect(traffic.totals).toMatchObject({
      sessions: 1,
      visitorDays: 1,
      pageViews: 1,
      unconsentedPageViews: 2,
    });
    expect(traffic.sources).toEqual([
      { source: 'facebook', medium: 'cpc', campaign: `e2e_${ctx.run}`, sessions: 1 },
    ]);

    // Sales reconcile exactly with the order groups placed today (other suites share the database).
    const [expected] = await ctx.prisma.$queryRaw<{ paid: bigint; gross: string }[]>`
      SELECT count(*) AS paid, coalesce(sum(gross_amount), 0)::text AS gross FROM order_groups
      WHERE placed_at >= ${startOfBangkokDay(today)} AND placed_at < ${startOfBangkokDay(addCalendarDays(today, 1))} AND status IN ('in_progress', 'completed')`;
    const sales = (await as(ctx, marketing).get(`/v1/admin/analytics/sales?${range}`).expect(200)).body as {
      totals: { groupsPaid: number; gmv: string };
      byProductType: { productType: { code: string }; ordersPaid: number }[];
    };
    expect(sales.totals.groupsPaid).toBe(Number(expected!.paid));
    expect(sales.totals.gmv).toBe(new MoneyDecimal(expected!.gross).toFixed(2));
    expect(
      sales.byProductType.find((t) => t.productType.code === 'folding_carton')!.ordersPaid,
    ).toBeGreaterThanOrEqual(1);

    // Demand: calculations of folding cartons today = the calculate log.
    const calcs = await ctx.prisma.calculateLog.count({
      where: {
        productTypeId: folding.id,
        occurredAt: { gte: startOfBangkokDay(today), lt: startOfBangkokDay(addCalendarDays(today, 1)) },
      },
    });
    const demand = (
      await as(ctx, marketing)
        .get(`/v1/admin/analytics/demand?${range}&groupBy=product_type,quantity_band`)
        .expect(200)
    ).body as {
      productType: { code: string };
      quantityBand: string;
      calculations: number;
      savedQuotes: number;
    }[];
    const foldingRows = demand.filter((r) => r.productType.code === 'folding_carton');
    expect(foldingRows.reduce((a, r) => a + r.calculations, 0)).toBe(calcs);
    expect(foldingRows.find((r) => r.quantityBand === '1000-4999')!.savedQuotes).toBeGreaterThanOrEqual(1);

    const sensitivity = (await as(ctx, marketing).get(`/v1/admin/analytics/sensitivity?${range}`).expect(200))
      .body;
    expect(sensitivity.byLeadTime).toEqual([{ band: '8-14', shown: 1, carted: 1, dropOffPct: '0.00' }]);
    expect(sensitivity.byPriceQuartile).toEqual([{ band: '1', shown: 1, carted: 1, dropOffPct: '0.00' }]);

    await as(ctx, marketing).get(`/v1/admin/analytics/unmet-demand?${range}`).expect(200);
    await as(ctx, marketing).get(`/v1/admin/analytics/campaigns?${range}`).expect(200);
    // Named factories are staff-only for the roles holding `analytics.read_factories` (D-044).
    await as(ctx, marketing).get(`/v1/admin/analytics/factories?${range}`).expect(403);
    const factories = (
      await as(ctx, partnerManager).get(`/v1/admin/analytics/factories?${range}`).expect(200)
    ).body as { factory: { id: string }; released: number }[];
    expect(factories.find((f) => f.factory.id === fixture.factoryPublicId)?.released).toBeGreaterThanOrEqual(
      1,
    );
    await as(ctx, await staffToken(ctx, 'cs'))
      .get(`/v1/admin/analytics/sales?${range}`)
      .expect(403);
    expect(
      (
        await as(ctx, marketing)
          .get(`/v1/admin/analytics/sales?from=${today}&to=${addCalendarDays(today, -1)}`)
          .expect(422)
      ).body.code,
    ).toBe('validation.failed');
  });

  it('re-runs are idempotent and backfills are queued, processed and listed', async () => {
    const snapshot = () => ctx.prisma.$queryRaw<{ t: string }[]>`
      SELECT (SELECT json_agg(f ORDER BY f::text) FROM analytics.fact_quotes f WHERE date_key = ${today}::date)::text
          || (SELECT coalesce(json_agg(f ORDER BY f::text), '[]') FROM analytics.fact_funnel f WHERE date_key = ${today}::date)::text
          || (SELECT coalesce(json_agg(f ORDER BY f::text), '[]') FROM analytics.fact_orders f WHERE date_key = ${today}::date)::text AS t`;
    const before = await snapshot();
    await as(ctx, marketing).post('/v1/admin/analytics/rollups', { from: today, to: today }).expect(403);
    expect(
      (await as(ctx, admin).post('/v1/admin/analytics/rollups', { from: today, to: today }).expect(202)).body,
    ).toEqual({ queued: 12 });
    await ctx.app.get(AnalyticsRollupService).processQueue();
    expect(await snapshot()).toEqual(before);
    const runs = (await as(ctx, admin).get(`/v1/admin/analytics/rollups?${range}`).expect(200)).body as {
      status: string;
      attempts: number;
    }[];
    expect(runs).toHaveLength(12);
    expect(runs.every((r) => r.status === 'succeeded' && r.attempts >= 2)).toBe(true);
  });

  it('generates the partner prospectus with every figure backed by k contributors', async () => {
    const service = ctx.app.get(ProspectusService);
    // With an unreachable k nothing non-zero survives: suppression is applied to every table and total.
    const strict = await service.content(today, today, 1_000_000);
    for (const t of strict.tables) {
      for (const row of t.rows) for (const v of row.values) expect(v === null || Number(v) === 0).toBe(true);
      for (const v of t.totals) expect(v === null || Number(v) === 0).toBe(true);
    }

    await as(ctx, marketing)
      .post('/v1/admin/analytics/prospectus-exports', { from: today, to: today })
      .set('Idempotency-Key', randomUUID())
      .expect(403);
    const requested = (
      await as(ctx, partnerManager)
        .post('/v1/admin/analytics/prospectus-exports', { from: today, to: today })
        .set('Idempotency-Key', randomUUID())
        .expect(202)
    ).body as { id: string; status: string; kThreshold: number };
    expect(requested).toMatchObject({ status: 'pending', kThreshold: 3 });
    await as(ctx, partnerManager)
      .get(`/v1/admin/analytics/prospectus-exports/${requested.id}/file?format=pdf`)
      .expect(409);
    expect(await service.processPending()).toBeGreaterThanOrEqual(1);
    const ready = (
      await as(ctx, partnerManager).get(`/v1/admin/analytics/prospectus-exports/${requested.id}`).expect(200)
    ).body as { status: string; suppressedCells: number };
    expect(ready.status).toBe('ready');
    expect(ready.suppressedCells).toBeGreaterThanOrEqual(0);
    for (const format of ['pdf', 'xlsx'])
      await as(ctx, partnerManager)
        .get(`/v1/admin/analytics/prospectus-exports/${requested.id}/file?format=${format}`)
        .expect(200);
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'prospectus.downloaded', resourcePublicId: requested.id },
      }),
    ).toBe(2);

    // The workbook: README with k, one sheet per table, no personal data.
    const [row] = await ctx.prisma.$queryRaw<{ key: string }[]>`
      SELECT f.storage_key AS key FROM analytics.prospectus_exports p JOIN file_objects f ON f.id = p.xlsx_file_id WHERE p.public_id = ${requested.id}::uuid`;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      (await readObject(ctx.app.get<ObjectStorage>(OBJECT_STORAGE), row!.key)) as unknown as ArrayBuffer,
    );
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'README',
      'demand_by_product_type',
      'demand_by_quantity_band',
      'demand_by_region',
      'unmet_demand',
      'price_gap',
      'monthly_trend',
      'factory_supply',
    ]);
    const text = wb.worksheets
      .flatMap((w) => (w.getSheetValues() as unknown[][]).flat().map((v) => String(v)))
      .join('|');
    expect(text).toContain('Minimum group size (k)');
    expect(text).not.toContain(customer.phone.slice(3));
    expect(text).not.toMatch(/@example\.invalid/);
    const factory = await ctx.prisma.factory.findUniqueOrThrow({
      where: { publicId: fixture.factoryPublicId },
    });
    expect(text).not.toContain(factory.legalName);
  });
});
