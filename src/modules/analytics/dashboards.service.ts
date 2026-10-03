import { DomainException } from '@common/errors/domain.exception';
import { MoneyDecimal } from '@common/money/money';
import { addCalendarDays, startOfBangkokDay } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { Prisma } from '@generated/prisma/client';
import { CapacityService } from '@modules/partners/capacity/capacity.service';
import { Injectable } from '@nestjs/common';
import { SettingsService } from '@platform/settings/settings.service';

import {
  type AnalyticsRefDto,
  type CampaignPerformanceDto,
  type CapacityLimitedWeekDto,
  DEMAND_DIMENSIONS,
  type DemandRowDto,
  type FactoryPerformanceDto,
  FUNNEL_STEPS,
  type FunnelReportDto,
  type INTERVALS,
  type SalesPointDto,
  type SalesReportDto,
  type SensitivityReportDto,
  type SensitivityRowDto,
  type TrafficPointDto,
  type TrafficReportDto,
  type UnmetDemandReportDto,
} from './analytics.dto';
import { daysBetween, MAX_BACKFILL_DAYS } from './rollups.service';

type Interval = (typeof INTERVALS)[number];
type Dimension = (typeof DEMAND_DIMENSIONS)[number];
type Num = number | bigint | Prisma.Decimal | null;

const D = (v: Num) => new MoneyDecimal((v ?? 0).toString());
const int = (v: Num) => Number(v ?? 0);
const money = (v: Num) => D(v).toFixed(2);
export function pct(numerator: Num, denominator: Num): string | null {
  return D(denominator).isZero() ? null : D(numerator).times(100).dividedBy(D(denominator)).toFixed(2);
}

const BUCKET: Record<Interval, Prisma.Sql> = {
  day: Prisma.sql`d.date_key`,
  week: Prisma.sql`d.week_start`,
  month: Prisma.sql`d.month_start`,
};

/** Unknown province / product type rows (id 0 in the facts). */
const UNKNOWN: AnalyticsRefDto = { id: null, code: 'unknown', nameTh: 'ไม่ทราบ', nameEn: 'Unknown' };

interface RefRow {
  pt_public_id: string | null;
  pt_code: string | null;
  pt_name_th: string | null;
  pt_name_en: string | null;
}
const productTypeRef = (r: RefRow): AnalyticsRefDto =>
  r.pt_code ? { id: r.pt_public_id, code: r.pt_code, nameTh: r.pt_name_th!, nameEn: r.pt_name_en! } : UNKNOWN;
const provinceRef = (r: {
  pv_public_id: string | null;
  pv_code: string | null;
  pv_name_th: string | null;
  pv_name_en: string | null;
}) =>
  r.pv_code ? { id: r.pv_public_id, code: r.pv_code, nameTh: r.pv_name_th!, nameEn: r.pv_name_en! } : UNKNOWN;

/**
 * Admin dashboards over the analytics facts (B6.1, D-102): traffic, funnel, demand (quotes & RFQs by product
 * type × spec band × quantity band × province), sales (GMV, AOV, conversion, repeat rate), price / lead-time
 * sensitivity, unmet demand with capacity-limited weeks, factory utilisation and on-time rates (staff-only,
 * D-044) and campaign performance. Figures are as of the last rollup (nightly; backfills on request).
 */
@Injectable()
export class AnalyticsDashboardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capacity: CapacityService,
    private readonly settings: SettingsService,
  ) {}

  range(from: string, to: string): { from: string; to: string } {
    if (from > to || daysBetween(from, to).length > MAX_BACKFILL_DAYS)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'to', code: 'range', message: `from ≤ to, at most ${MAX_BACKFILL_DAYS} days` }],
      });
    return { from, to };
  }

  async productTypeId(publicId: string | undefined): Promise<bigint | null> {
    if (!publicId) return null;
    const row = await this.prisma.productType.findUnique({ where: { publicId }, select: { id: true } });
    if (!row) throw new DomainException('http.not_found');
    return row.id;
  }

  // --- traffic ---------------------------------------------------------------------------------------------

  async traffic(from: string, to: string, interval: Interval): Promise<TrafficReportDto> {
    this.range(from, to);
    const rows = await this.prisma.$queryRaw<
      { period: Date; sessions: Num; visitors: Num; pv: Num; upv: Num }[]
    >`
      SELECT ${BUCKET[interval]} AS period, sum(f.sessions) AS sessions, sum(f.visitors) AS visitors,
             sum(f.page_views) FILTER (WHERE f.consent_state = 'granted') AS pv,
             sum(f.page_views) FILTER (WHERE f.consent_state = 'denied') AS upv
      FROM analytics.fact_sessions f JOIN analytics.dim_date d USING (date_key)
      WHERE f.date_key BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1 ORDER BY 1`;
    const point = (
      period: string,
      r: { sessions: Num; visitors: Num; pv: Num; upv: Num },
    ): TrafficPointDto => ({
      period,
      sessions: int(r.sessions),
      visitorDays: int(r.visitors),
      pageViews: int(r.pv),
      unconsentedPageViews: int(r.upv),
    });
    const series = rows.map((r) => point(dayOf(r.period), r));
    const sum = (k: 'sessions' | 'visitors' | 'pv' | 'upv') => rows.reduce((a, r) => a + int(r[k]), 0);
    const sources = await this.prisma.$queryRaw<
      { source: string; medium: string; campaign: string; sessions: Num }[]
    >`
      SELECT utm_source AS source, utm_medium AS medium, utm_campaign AS campaign, sum(sessions) AS sessions
      FROM analytics.fact_sessions WHERE date_key BETWEEN ${from}::date AND ${to}::date AND consent_state = 'granted'
      GROUP BY 1, 2, 3 ORDER BY 4 DESC, 1 LIMIT 20`;
    const devices = await this.prisma.$queryRaw<{ device_class: string; sessions: Num; pv: Num }[]>`
      SELECT device_class, sum(sessions) AS sessions, sum(page_views) FILTER (WHERE consent_state = 'granted') AS pv
      FROM analytics.fact_sessions WHERE date_key BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1 ORDER BY 2 DESC, 1`;
    return {
      series,
      totals: {
        period: from,
        sessions: sum('sessions'),
        visitorDays: sum('visitors'),
        pageViews: sum('pv'),
        unconsentedPageViews: sum('upv'),
      },
      sources: sources.map((s) => ({
        source: s.source,
        medium: s.medium,
        campaign: s.campaign,
        sessions: int(s.sessions),
      })),
      devices: devices.map((d) => ({
        deviceClass: d.device_class,
        sessions: int(d.sessions),
        consentedPageViews: int(d.pv),
      })),
    };
  }

  // --- funnel ----------------------------------------------------------------------------------------------

  async funnel(from: string, to: string, productTypePublicId?: string): Promise<FunnelReportDto> {
    this.range(from, to);
    const typeId = await this.productTypeId(productTypePublicId);
    const [r] = await this.prisma.$queryRaw<Record<string, Num>[]>`
      SELECT sum(visits) AS visit, sum(configured) AS configure, sum(quoted) AS quote, sum(carted) AS cart,
             sum(checkout_started) AS checkout, sum(placed) AS placed, sum(paid) AS paid
      FROM analytics.fact_funnel
      WHERE date_key BETWEEN ${from}::date AND ${to}::date AND product_type_id = ${typeId ?? 0n}`;
    const counts = FUNNEL_STEPS.map((step) => int(r?.[step] ?? 0));
    return {
      productType: typeId ? await this.productTypeRef(typeId) : null,
      steps: FUNNEL_STEPS.map((step, i) => ({
        step,
        sessions: counts[i]!,
        fromPreviousPct: i === 0 ? null : pct(counts[i]!, counts[i - 1]!),
        fromVisitPct: i === 0 ? null : pct(counts[i]!, counts[0]!),
      })),
    };
  }

  private async productTypeRef(id: bigint): Promise<AnalyticsRefDto> {
    const pt = await this.prisma.productType.findUniqueOrThrow({ where: { id } });
    return { id: pt.publicId, code: pt.code, nameTh: pt.nameTh, nameEn: pt.nameEn };
  }

  // --- demand ----------------------------------------------------------------------------------------------

  async demand(
    from: string,
    to: string,
    groupBy: Dimension[] = ['product_type'],
    productTypePublicId?: string,
  ): Promise<DemandRowDto[]> {
    this.range(from, to);
    const typeId = await this.productTypeId(productTypePublicId);
    const dims = new Set<Dimension>(groupBy.length ? groupBy : ['product_type']);
    const col = (d: Dimension, sql: string, type: 'bigint' | 'text') =>
      Prisma.raw(dims.has(d) ? sql : `NULL::${type}`);
    const typeFilter = typeId ? Prisma.sql`AND product_type_id = ${typeId}` : Prisma.empty;
    const measures = (quotes: boolean) =>
      Prisma.raw(
        quotes
          ? 'calculations, instant_calculations, routed_to_rfq, saved_quotes, converted_quotes, 0 AS submitted, 0 AS quoted, 0 AS accepted, 0 AS declined, 0 AS expired, 0 AS first_responses, 0 AS first_response_minutes'
          : '0, 0, 0, 0, 0, submitted, quoted, accepted, declined, expired, first_responses, first_response_minutes',
      );
    const rows = await this.prisma.$queryRaw<(RefRow & Record<string, Num | string | null>)[]>`
      WITH src AS (
        SELECT product_type_id, spec_band, quantity_band, province_id, channel, ${measures(true)}
        FROM analytics.fact_quotes WHERE date_key BETWEEN ${from}::date AND ${to}::date ${typeFilter}
        UNION ALL
        SELECT product_type_id, spec_band, quantity_band, province_id, channel, ${measures(false)}
        FROM analytics.fact_rfqs WHERE date_key BETWEEN ${from}::date AND ${to}::date ${typeFilter}
      ), g AS (
        SELECT ${col('product_type', 'product_type_id', 'bigint')} AS product_type_id, ${col('spec_band', 'spec_band', 'text')} AS spec_band,
               ${col('quantity_band', 'quantity_band', 'text')} AS quantity_band, ${col('province', 'province_id', 'bigint')} AS province_id,
               ${col('channel', 'channel', 'text')} AS channel,
               sum(calculations) AS calculations, sum(instant_calculations) AS instant, sum(routed_to_rfq) AS routed,
               sum(saved_quotes) AS saved, sum(converted_quotes) AS converted, sum(submitted) AS submitted, sum(quoted) AS quoted,
               sum(accepted) AS accepted, sum(declined) AS declined, sum(expired) AS expired,
               sum(first_responses) AS first_responses, sum(first_response_minutes) AS first_response_minutes
        FROM src GROUP BY 1, 2, 3, 4, 5
      )
      SELECT g.*, pt.public_id::text AS pt_public_id, pt.code AS pt_code, pt.name_th AS pt_name_th, pt.name_en AS pt_name_en,
             pv.public_id::text AS pv_public_id, pv.code AS pv_code, pv.name_th AS pv_name_th, pv.name_en AS pv_name_en
      FROM g
      LEFT JOIN product_types pt ON pt.id = g.product_type_id
      LEFT JOIN geo_provinces pv ON pv.id = g.province_id
      LEFT JOIN analytics.dim_quantity_band qb ON qb.code = g.quantity_band
      ORDER BY g.calculations + g.submitted DESC, pt.code, qb.sort, g.spec_band
      LIMIT 500`;
    return rows.map((r) => ({
      productType: dims.has('product_type') ? productTypeRef(r) : null,
      specBand: dims.has('spec_band') ? (r['spec_band'] as string) : null,
      quantityBand: dims.has('quantity_band') ? (r['quantity_band'] as string) : null,
      province: dims.has('province') ? provinceRef(r as never) : null,
      channel: dims.has('channel') ? (r['channel'] as string) : null,
      calculations: int(r['calculations'] as Num),
      instantCalculations: int(r['instant'] as Num),
      routedToRfq: int(r['routed'] as Num),
      savedQuotes: int(r['saved'] as Num),
      convertedQuotes: int(r['converted'] as Num),
      rfqsSubmitted: int(r['submitted'] as Num),
      rfqsQuoted: int(r['quoted'] as Num),
      rfqsAccepted: int(r['accepted'] as Num),
      rfqsDeclined: int(r['declined'] as Num),
      rfqsExpired: int(r['expired'] as Num),
      avgFirstResponseMinutes: D(r['first_responses'] as Num).isZero()
        ? null
        : D(r['first_response_minutes'] as Num)
            .dividedBy(D(r['first_responses'] as Num))
            .toFixed(2),
    }));
  }

  // --- sales -----------------------------------------------------------------------------------------------

  async sales(from: string, to: string, interval: Interval): Promise<SalesReportDto> {
    this.range(from, to);
    type Row = { period: Date; placed: Num; paid: Num; gross: Num; net: Num; returning: Num; consumer: Num };
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT ${BUCKET[interval]} AS period, sum(f.groups_placed) AS placed, sum(f.groups_paid) AS paid,
             sum(f.gross_paid) AS gross, sum(f.net_paid) AS net,
             sum(f.groups_paid) FILTER (WHERE f.customer_segment = 'returning') AS returning,
             sum(f.groups_paid) FILTER (WHERE f.customer_segment <> 'b2b') AS consumer
      FROM analytics.fact_orders f JOIN analytics.dim_date d USING (date_key)
      WHERE f.date_key BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1 ORDER BY 1`;
    const point = (period: string, r: Omit<Row, 'period'>): SalesPointDto => ({
      period,
      groupsPlaced: int(r.placed),
      groupsPaid: int(r.paid),
      gmv: money(r.gross),
      netSales: money(r.net),
      aov: D(r.paid).isZero() ? null : D(r.gross).dividedBy(D(r.paid)).toFixed(2),
      repeatRatePct: pct(r.returning, r.consumer),
    });
    const total = (k: keyof Omit<Row, 'period'>) =>
      rows.reduce((a, r) => a.plus(D(r[k])), new MoneyDecimal(0));
    const [funnel] = await this.prisma.$queryRaw<{ visits: Num; paid: Num }[]>`
      SELECT sum(visits) AS visits, sum(paid) AS paid FROM analytics.fact_funnel
      WHERE date_key BETWEEN ${from}::date AND ${to}::date AND product_type_id = 0`;
    const breakdown = (column: 'channel' | 'customer_segment') => this.prisma.$queryRaw<
      { key: string; paid: Num; gross: Num }[]
    >`
      SELECT ${Prisma.raw(column)} AS key, sum(groups_paid) AS paid, sum(gross_paid) AS gross
      FROM analytics.fact_orders WHERE date_key BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1 HAVING sum(groups_paid) > 0 ORDER BY 3 DESC, 1`;
    const byType = await this.prisma.$queryRaw<(RefRow & { orders: Num; quantity: Num; gross: Num })[]>`
      SELECT pt.public_id::text AS pt_public_id, pt.code AS pt_code, pt.name_th AS pt_name_th, pt.name_en AS pt_name_en,
             sum(f.orders_paid) AS orders, sum(f.quantity_paid) AS quantity, sum(f.gross_paid) AS gross
      FROM analytics.fact_order_items f JOIN product_types pt ON pt.id = f.product_type_id
      WHERE f.date_key BETWEEN ${from}::date AND ${to}::date
      GROUP BY pt.id HAVING sum(f.orders_paid) > 0 ORDER BY 7 DESC, 2`;
    const toBreakdown = (rs: { key: string; paid: Num; gross: Num }[]) =>
      rs.map((b) => ({ key: b.key, groupsPaid: int(b.paid), gmv: money(b.gross) }));
    return {
      series: rows.map((r) => point(dayOf(r.period), r)),
      totals: point(from, {
        placed: total('placed').toNumber(),
        paid: total('paid').toNumber(),
        gross: new Prisma.Decimal(total('gross').toString()),
        net: new Prisma.Decimal(total('net').toString()),
        returning: total('returning').toNumber(),
        consumer: total('consumer').toNumber(),
      }),
      sessionConversionPct: pct(funnel?.paid ?? 0, funnel?.visits ?? 0),
      byChannel: toBreakdown(await breakdown('channel')),
      bySegment: toBreakdown(await breakdown('customer_segment')),
      byProductType: byType.map((t) => ({
        productType: productTypeRef(t),
        ordersPaid: int(t.orders),
        quantityPaid: D(t.quantity).toFixed(0),
        gmv: money(t.gross),
      })),
    };
  }

  // --- price / lead-time sensitivity (from consented raw events) ------------------------------------------

  async sensitivity(from: string, to: string, productTypePublicId?: string): Promise<SensitivityReportDto> {
    this.range(from, to);
    const typeId = await this.productTypeId(productTypePublicId);
    const start = startOfBangkokDay(from);
    const end = startOfBangkokDay(addCalendarDays(to, 1));
    const typeFilter = typeId ? Prisma.sql`AND pt.id = ${typeId}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ kind: string; band: string; shown: Num; carted: Num }[]>`
      WITH ev AS (
        SELECT e.session_id, e.event_name, e.properties, pt.id AS product_type_id
        FROM analytics.raw_events e JOIN product_types pt ON pt.code = e.product_type_code
        WHERE e.source = 'bff' AND e.consent_state = 'granted' AND e.event_name IN ('quote_shown', 'add_to_cart')
          AND e.occurred_at >= ${start} AND e.occurred_at < ${end} ${typeFilter}
      ), shown AS (
        SELECT session_id, product_type_id, properties->>'quantityBand' AS qb,
               CASE WHEN properties->>'leadTimeDays' IS NULL THEN 'unknown'
                    WHEN (properties->>'leadTimeDays')::int <= 7 THEN '0-7'
                    WHEN (properties->>'leadTimeDays')::int <= 14 THEN '8-14'
                    WHEN (properties->>'leadTimeDays')::int <= 21 THEN '15-21'
                    WHEN (properties->>'leadTimeDays')::int <= 30 THEN '22-30'
                    ELSE '31+' END AS lead_band,
               nullif(properties->>'unitPrice', '')::numeric AS price
        FROM ev WHERE event_name = 'quote_shown'
      ), carted AS (
        SELECT DISTINCT session_id, product_type_id FROM ev WHERE event_name = 'add_to_cart'
      ), priced AS (
        SELECT *, ntile(4) OVER (PARTITION BY product_type_id, qb ORDER BY price) AS quartile FROM shown WHERE price IS NOT NULL
      ), obs AS (
        SELECT DISTINCT 'lead' AS kind, lead_band AS band, s.session_id, s.product_type_id FROM shown s
        UNION
        SELECT DISTINCT 'price', quartile::text, p.session_id, p.product_type_id FROM priced p
      )
      SELECT o.kind, o.band, count(*) AS shown, count(c.session_id) AS carted
      FROM obs o LEFT JOIN carted c ON c.session_id = o.session_id AND c.product_type_id = o.product_type_id
      GROUP BY 1, 2 ORDER BY 1, 2`;
    const row = (r: { band: string; shown: Num; carted: Num }): SensitivityRowDto => ({
      band: r.band,
      shown: int(r.shown),
      carted: int(r.carted),
      dropOffPct: pct(int(r.shown) - int(r.carted), r.shown),
    });
    const leadOrder = ['0-7', '8-14', '15-21', '22-30', '31+', 'unknown'];
    return {
      byLeadTime: rows
        .filter((r) => r.kind === 'lead')
        .sort((a, b) => leadOrder.indexOf(a.band) - leadOrder.indexOf(b.band))
        .map(row),
      byPriceQuartile: rows.filter((r) => r.kind === 'price').map(row),
    };
  }

  // --- unmet demand ----------------------------------------------------------------------------------------

  async unmetDemand(from: string, to: string): Promise<UnmetDemandReportDto> {
    this.range(from, to);
    const count = (column: 'source' | 'reason_code') => this.prisma.$queryRaw<
      { key: string; records: Num }[]
    >`
      SELECT ${Prisma.raw(column)} AS key, sum(records) AS records FROM analytics.fact_unmet_demand
      WHERE date_key BETWEEN ${from}::date AND ${to}::date AND source <> 'price_above_target'
      GROUP BY 1 ORDER BY 2 DESC, 1`;
    const rows = await this.prisma.$queryRaw<(RefRow & Record<string, string | Num | null>)[]>`
      SELECT f.source, f.reason_code, f.spec_band, f.quantity_band, sum(f.records) AS records,
             pt.public_id::text AS pt_public_id, pt.code AS pt_code, pt.name_th AS pt_name_th, pt.name_en AS pt_name_en,
             pv.public_id::text AS pv_public_id, pv.code AS pv_code, pv.name_th AS pv_name_th, pv.name_en AS pv_name_en
      FROM analytics.fact_unmet_demand f
      JOIN product_types pt ON pt.id = f.product_type_id
      LEFT JOIN geo_provinces pv ON pv.id = f.province_id
      WHERE f.date_key BETWEEN ${from}::date AND ${to}::date AND f.source <> 'price_above_target'
      GROUP BY f.source, f.reason_code, f.spec_band, f.quantity_band, pt.id, pv.id
      ORDER BY 5 DESC, pt.code LIMIT 200`;
    return {
      bySource: (await count('source')).map((c) => ({ key: c.key, records: int(c.records) })),
      byReason: (await count('reason_code')).map((c) => ({ key: c.key, records: int(c.records) })),
      rows: rows.map((r) => ({
        productType: productTypeRef(r),
        source: r['source'] as string,
        reasonCode: r['reason_code'] as string,
        specBand: r['spec_band'] as string,
        quantityBand: r['quantity_band'] as string,
        province: r['pv_code'] ? provinceRef(r as never) : null,
        records: int(r['records'] as Num),
      })),
      capacityLimitedWeeks: await this.capacityLimitedWeeks(from, to),
      priceGap: await this.priceGap(from, to),
    };
  }

  /**
   * D-252: quotations above the customer's target, by product type × quantity band × gap band, read from the records
   * (distinct customers per cell); a cell below `analytics.target_price_min_group_size` is withheld (D-190) — in the
   * staff view as in the prospectus.
   */
  private async priceGap(from: string, to: string) {
    const k = (await this.settings.at('analytics.target_price_min_group_size')).value;
    const rows = await this.prisma.$queryRaw<(RefRow & Record<string, string | Num | null>)[]>`
      SELECT u.quantity_band, u.price_gap_band, count(*) AS records, count(DISTINCT u.customer_key) AS customers,
             pt.public_id::text AS pt_public_id, pt.code AS pt_code, pt.name_th AS pt_name_th, pt.name_en AS pt_name_en
      FROM unmet_demand_records u JOIN product_types pt ON pt.id = u.product_type_id
      WHERE u.source = 'price_above_target'
        AND u.occurred_at >= ${from}::date::timestamp AT TIME ZONE 'Asia/Bangkok'
        AND u.occurred_at < (${to}::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'
      GROUP BY pt.id, u.quantity_band, u.price_gap_band
      ORDER BY pt.code, u.quantity_band, u.price_gap_band`;
    const kept = rows.filter((r) => int(r['customers'] as Num) >= k);
    return {
      minGroupSize: k,
      rows: kept.map((r) => ({
        productType: productTypeRef(r),
        quantityBand: r['quantity_band'] as string,
        priceGapBand: r['price_gap_band'] as string,
        records: int(r['records'] as Num),
        customers: int(r['customers'] as Num),
      })),
      suppressedRows: rows.length - kept.length,
    };
  }

  /** Weeks of the range in which an active factory with capacity for a product type was fully booked (D-101). */
  private async capacityLimitedWeeks(from: string, to: string): Promise<CapacityLimitedWeekDto[]> {
    const pairs = await this.prisma.factoryCapacity.findMany({
      where: { factory: { status: 'active' } },
      include: { productType: true },
    });
    const weeks = Math.min(Math.ceil((daysBetween(from, to).length + 6) / 7) + 1, 60);
    const byWeek = new Map<string, CapacityLimitedWeekDto>();
    for (const pair of pairs) {
      for (const w of await this.capacity.weeks(pair.factoryId, pair.productTypeId, from, weeks)) {
        if (w.weekStart > to || addCalendarDays(w.weekStart, 6) < from) continue;
        const key = `${pair.productTypeId}:${w.weekStart}`;
        const entry = byWeek.get(key) ?? {
          productType: {
            id: pair.productType.publicId,
            code: pair.productType.code,
            nameTh: pair.productType.nameTh,
            nameEn: pair.productType.nameEn,
          },
          weekStart: w.weekStart,
          factories: 0,
          factoriesFull: 0,
        };
        entry.factories++;
        if (w.capacity.greaterThan(0) && w.free.isZero()) entry.factoriesFull++;
        byWeek.set(key, entry);
      }
    }
    return [...byWeek.values()]
      .filter((w) => w.factoriesFull > 0)
      .sort(
        (a, b) =>
          a.weekStart.localeCompare(b.weekStart) || a.productType.code.localeCompare(b.productType.code),
      );
  }

  // --- factories (staff-only, D-044) -----------------------------------------------------------------------

  async factories(from: string, to: string): Promise<FactoryPerformanceDto[]> {
    this.range(from, to);
    const rows = await this.prisma.$queryRaw<
      (RefRow & Record<string, Num | string | null> & { factory_id: bigint; product_type_id: bigint })[]
    >`
      WITH j AS (
        SELECT factory_id, product_type_id, sum(released) AS released, sum(accepted) AS accepted,
               sum(accepted_on_time) AS accepted_on_time, sum(rejected) AS rejected, sum(shipped) AS shipped,
               sum(shipped_with_promise) AS with_promise, sum(shipped_on_time) AS shipped_on_time
        FROM analytics.fact_jobs WHERE date_key BETWEEN ${from}::date AND ${to}::date GROUP BY 1, 2
      ), c AS (
        SELECT factory_id, product_type_id, sum(submitted) AS claims FROM analytics.fact_claims
        WHERE date_key BETWEEN ${from}::date AND ${to}::date AND liability = 'factory' AND factory_id <> 0 GROUP BY 1, 2
      )
      SELECT coalesce(j.factory_id, c.factory_id) AS factory_id, coalesce(j.product_type_id, c.product_type_id) AS product_type_id,
             j.released, j.accepted, j.accepted_on_time, j.rejected, j.shipped, j.with_promise, j.shipped_on_time, c.claims,
             f.public_id::text AS f_public_id, f.code AS f_code, coalesce(f.trade_name, f.legal_name) AS f_name,
             pt.public_id::text AS pt_public_id, pt.code AS pt_code, pt.name_th AS pt_name_th, pt.name_en AS pt_name_en
      FROM j FULL JOIN c ON c.factory_id = j.factory_id AND c.product_type_id = j.product_type_id
      JOIN factories f ON f.id = coalesce(j.factory_id, c.factory_id)
      JOIN product_types pt ON pt.id = coalesce(j.product_type_id, c.product_type_id)
      ORDER BY f.code, pt.code`;
    const out: FactoryPerformanceDto[] = [];
    for (const r of rows) {
      out.push({
        factory: {
          id: r['f_public_id'] as string,
          code: r['f_code'] as string,
          nameTh: r['f_name'] as string,
          nameEn: r['f_name'] as string,
        },
        productType: productTypeRef(r),
        released: int(r['released'] as Num),
        accepted: int(r['accepted'] as Num),
        acceptedOnTimePct: pct(r['accepted_on_time'] as Num, r['accepted'] as Num),
        rejected: int(r['rejected'] as Num),
        shipped: int(r['shipped'] as Num),
        shippedOnTimePct: pct(r['shipped_on_time'] as Num, r['with_promise'] as Num),
        claims: int(r['claims'] as Num),
        utilisationPct: await this.utilisation(r.factory_id, r.product_type_id, from, to),
      });
    }
    return out;
  }

  private async utilisation(
    factoryId: bigint,
    productTypeId: bigint,
    from: string,
    to: string,
  ): Promise<string | null> {
    const weeks = Math.min(Math.ceil((daysBetween(from, to).length + 6) / 7) + 1, 60);
    const inRange = (await this.capacity.weeks(factoryId, productTypeId, from, weeks)).filter(
      (w) => w.weekStart <= to,
    );
    const capacity = inRange.reduce((a, w) => a.plus(w.capacity), new Prisma.Decimal(0));
    const booked = inRange.reduce((a, w) => a.plus(w.booked), new Prisma.Decimal(0));
    return pct(booked, capacity);
  }

  // --- campaigns -------------------------------------------------------------------------------------------

  async campaigns(from: string, to: string): Promise<CampaignPerformanceDto[]> {
    this.range(from, to);
    const rows = await this.prisma.$queryRaw<Record<string, Num | string | null>[]>`
      SELECT c.public_id::text AS id, c.code, c.name, c.status::text AS status, c.budget_amount AS budget, c.spent_amount AS spent,
             sum(f.redemptions) AS redemptions, sum(f.reversals) AS reversals, sum(f.discount_amount) AS discount,
             sum(f.capped_amount) AS capped, sum(f.order_groups) AS groups, sum(f.gross_amount) AS gross, sum(f.new_customers) AS new_customers
      FROM analytics.fact_campaigns f JOIN campaigns c ON c.id = f.campaign_id
      WHERE f.date_key BETWEEN ${from}::date AND ${to}::date
      GROUP BY c.id ORDER BY sum(f.gross_amount) DESC, c.code`;
    return rows.map((r) => ({
      id: r['id'] as string,
      code: r['code'] as string,
      name: r['name'] as string,
      status: r['status'] as string,
      budget: r['budget'] === null ? null : money(r['budget'] as Num),
      spent: money(r['spent'] as Num),
      redemptions: int(r['redemptions'] as Num),
      reversals: int(r['reversals'] as Num),
      discountAmount: money(r['discount'] as Num),
      cappedAmount: money(r['capped'] as Num),
      orderGroups: int(r['groups'] as Num),
      grossAmount: money(r['gross'] as Num),
      newCustomers: int(r['new_customers'] as Num),
    }));
  }
}

function dayOf(value: Date): string {
  return value.toISOString().slice(0, 10);
}
