import { CurrentActor, OptionalActor, Public } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiAsync, ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { DocumentFilesService } from '@modules/receivables/document-files.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { DownloadUrlDto } from '@platform/files/files.dto';

import {
  AnalyticsConsentDto,
  AnalyticsConsentResultDto,
  AnalyticsEventBatchDto,
  AnalyticsIngestResultDto,
  AnalyticsProductTypeQuery,
  AnalyticsRangeQuery,
  AnalyticsSeriesQuery,
  CampaignPerformanceDto,
  CreateProspectusDto,
  DemandQuery,
  DemandRowDto,
  EXAMPLES,
  FactoryPerformanceDto,
  FunnelReportDto,
  ProspectusExportDto,
  ProspectusFileQuery,
  RollupQueuedDto,
  RollupRequestDto,
  RollupRunDto,
  SalesReportDto,
  SensitivityReportDto,
  TrafficReportDto,
  UnmetDemandReportDto,
} from './analytics.dto';
import { AnalyticsDashboardsService } from './dashboards.service';
import { AnalyticsIngestionService } from './ingestion.service';
import { type ProspectusRow, ProspectusService } from './prospectus.service';
import { AnalyticsRollupService } from './rollups.service';

const DOCS = ['D-102'];
const day = (d: Date) => d.toISOString().slice(0, 10);

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('store', 'analytics')
@Controller('analytics')
export class StoreAnalyticsController {
  constructor(private readonly ingestion: AnalyticsIngestionService) {}

  @Post('events')
  @Public()
  @HttpCode(202)
  @ApiEndpoint({
    id: 'store.analytics.ingest',
    summary: 'Post analytics events',
    description:
      'Up to 50 frontend events (page views, configurator steps, quote shown, add to cart, checkout steps) posted by the BFF. ' +
      'Consent mode (PDPA): the visitor’s `analytics_cookies` consent is resolved on the server — the signed-in customer’s own ' +
      'decision first, else the anonymous visitor’s (`store.analytics.recordConsent`). Without consent no identifier ' +
      '(visitor, session, user, province) is kept. Properties follow a closed schema per event; exact quantities are stored as ' +
      'bands; page paths lose query strings and identifier-like segments; no IP is stored. A replayed `eventId` is ignored.',
    implements: [...DOCS, 'D-005'],
  })
  @ApiBody({
    type: AnalyticsEventBatchDto,
    examples: {
      default: {
        value: {
          events: [
            {
              eventId: EXAMPLES.ids.event,
              name: 'quote_shown',
              occurredAt: '2026-10-01T10:15:00+07:00',
              anonymousId: 'a8Kd02mZqL5x',
              sessionId: 's-7f3c91d2e0',
              pagePath: '/configure/folding_carton',
              productTypeCode: 'folding_carton',
              properties: { quantity: 1000, instant: true, leadTimeDays: 12, unitPrice: '4.250000' },
              utm: { source: 'facebook', medium: 'cpc', campaign: 'launch_2026' },
              deviceClass: 'mobile',
              postcode: '10110',
            },
          ],
        },
      },
    },
  })
  @ApiAsync({ poll: null })
  @ApiSuccess(202, {
    description: 'Accepted',
    type: AnalyticsIngestResultDto,
    example: { accepted: 1, duplicates: 0, dropped: 0 },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
  ingest(
    @OptionalActor() actor: Actor | undefined,
    @Body() body: AnalyticsEventBatchDto,
  ): Promise<AnalyticsIngestResultDto> {
    return this.ingestion.ingest(actor, body.events);
  }

  @Post('consent')
  @Public()
  @HttpCode(200)
  @ApiEndpoint({
    id: 'store.analytics.recordConsent',
    summary: 'Record the visitor’s analytics-cookie consent',
    description:
      'getpack’s own consent management (D-005, PDPA): appends a consent record for the anonymous visitor (and for the ' +
      'signed-in customer, when a token is sent) against the text in force; the latest record wins. ' +
      '`consent.purpose_unavailable` until the consent text has an approved version.',
    implements: [...DOCS, 'D-005'],
  })
  @ApiBody({
    type: AnalyticsConsentDto,
    examples: { default: { value: { anonymousId: 'a8Kd02mZqL5x', granted: true } } },
  })
  @ApiSuccess(200, {
    description: 'Recorded',
    type: AnalyticsConsentResultDto,
    example: { granted: true, versionNo: 1, recordedAt: '2026-10-01T10:14:00+07:00' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'validation.failed',
    'consent.purpose_unavailable',
  )
  async consent(
    @OptionalActor() actor: Actor | undefined,
    @Body() body: AnalyticsConsentDto,
  ): Promise<AnalyticsConsentResultDto> {
    const result = await this.ingestion.recordConsent(actor, body.anonymousId, body.granted);
    return {
      granted: result.granted,
      versionNo: result.versionNo,
      recordedAt: toBangkokIso(result.recordedAt),
    };
  }
}

const TRAFFIC_EXAMPLE: TrafficReportDto = {
  series: [
    { period: '2026-10-01', sessions: 420, visitorDays: 380, pageViews: 1650, unconsentedPageViews: 910 },
  ],
  totals: {
    period: '2026-10-01',
    sessions: 420,
    visitorDays: 380,
    pageViews: 1650,
    unconsentedPageViews: 910,
  },
  sources: [{ source: 'facebook', medium: 'cpc', campaign: 'launch_2026', sessions: 120 }],
  devices: [{ deviceClass: 'mobile', sessions: 300, consentedPageViews: 1200 }],
};
const DEMAND_EXAMPLE: DemandRowDto = {
  productType: EXAMPLES.productType,
  specBand: null,
  quantityBand: '1000-4999',
  province: null,
  channel: null,
  calculations: 240,
  instantCalculations: 200,
  routedToRfq: 40,
  savedQuotes: 35,
  convertedQuotes: 12,
  rfqsSubmitted: 8,
  rfqsQuoted: 6,
  rfqsAccepted: 3,
  rfqsDeclined: 1,
  rfqsExpired: 1,
  avgFirstResponseMinutes: '95.50',
};
const SALES_POINT = {
  period: '2026-10-01',
  groupsPlaced: 30,
  groupsPaid: 22,
  gmv: '215000.00',
  netSales: '200934.58',
  aov: '9772.73',
  repeatRatePct: '27.27',
};
const PROSPECTUS_EXAMPLE: ProspectusExportDto = {
  id: EXAMPLES.ids.prospectus,
  status: 'ready',
  from: '2026-10-01',
  to: '2026-12-31',
  kThreshold: 3,
  suppressedCells: 14,
  error: null,
  requestedAt: '2027-01-05T09:00:00+07:00',
  generatedAt: '2027-01-05T09:01:10+07:00',
};
const RANGE_ERRORS = ['validation.failed'] as const;

export function prospectusDto(r: ProspectusRow): ProspectusExportDto {
  return {
    id: r.public_id,
    status: r.status,
    from: day(r.period_from),
    to: day(r.period_to),
    kThreshold: Number(r.k_threshold),
    suppressedCells: r.suppressed_cells === null ? null : Number(r.suppressed_cells),
    error: r.error,
    requestedAt: toBangkokIso(r.requested_at),
    generatedAt: r.generated_at ? toBangkokIso(r.generated_at) : null,
  };
}

@ApiSurface('admin', 'analytics')
@Controller('analytics')
export class AdminAnalyticsController {
  constructor(
    private readonly dashboards: AnalyticsDashboardsService,
    private readonly rollups: AnalyticsRollupService,
    private readonly prospectus: ProspectusService,
    private readonly files: DocumentFilesService,
  ) {}

  @Get('traffic')
  @Can('analytics.read')
  @ApiEndpoint({
    id: 'admin.analytics.traffic',
    summary: 'Traffic',
    description:
      'Consented sessions, visitor-days and page views per day / week / month, top sources (UTM) and devices; unconsented hits count page views only (PDPA).',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Traffic', type: TrafficReportDto, example: TRAFFIC_EXAMPLE })
  @ApiStandardErrors(...RANGE_ERRORS)
  traffic(@Query() q: AnalyticsSeriesQuery): Promise<TrafficReportDto> {
    return this.dashboards.traffic(q.from, q.to, q.interval);
  }

  @Get('funnel')
  @Can('analytics.read')
  @ApiEndpoint({
    id: 'admin.analytics.funnel',
    summary: 'Funnel',
    description:
      'Consented sessions reaching visit → configure → quote → cart → checkout → placed → paid, overall or for one product type, with step conversions.',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Funnel',
    type: FunnelReportDto,
    example: {
      productType: null,
      steps: [
        { step: 'visit', sessions: 420, fromPreviousPct: null, fromVisitPct: null },
        { step: 'configure', sessions: 180, fromPreviousPct: '42.86', fromVisitPct: '42.86' },
      ],
    },
  })
  @ApiStandardErrors('http.not_found', ...RANGE_ERRORS)
  funnel(@Query() q: AnalyticsProductTypeQuery): Promise<FunnelReportDto> {
    return this.dashboards.funnel(q.from, q.to, q.productTypeId);
  }

  @Get('demand')
  @Can('analytics.read')
  @ApiEndpoint({
    id: 'admin.analytics.demand',
    summary: 'Quotes & RFQs by dimension',
    description:
      'Price calculations, saved / converted quotations and RFQ outcomes grouped by any of product type, spec band (50 mm), quantity band, province and channel; top 500 cells.',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Cells', type: [DemandRowDto], example: [DEMAND_EXAMPLE] })
  @ApiStandardErrors('http.not_found', ...RANGE_ERRORS)
  demand(@Query() q: DemandQuery): Promise<DemandRowDto[]> {
    return this.dashboards.demand(q.from, q.to, q.groupBy ?? [], q.productTypeId);
  }

  @Get('sales')
  @Can('analytics.read')
  @ApiEndpoint({
    id: 'admin.analytics.sales',
    summary: 'GMV, AOV, conversion and repeat rate',
    description:
      'Order groups by the day they were placed: GMV (gross incl. VAT of paid — or B2B credit-confirmed — groups), net sales, AOV, repeat rate (paid non-B2B groups from returning customers), session conversion, by channel, segment and product type.',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Sales',
    type: SalesReportDto,
    example: {
      series: [SALES_POINT],
      totals: SALES_POINT,
      sessionConversionPct: '1.85',
      byChannel: [{ key: 'web', groupsPaid: 15, gmv: '150000.00' }],
      bySegment: [{ key: 'new', groupsPaid: 16, gmv: '160000.00' }],
      byProductType: [
        { productType: EXAMPLES.productType, ordersPaid: 18, quantityPaid: '52000', gmv: '180000.00' },
      ],
    },
  })
  @ApiStandardErrors(...RANGE_ERRORS)
  sales(@Query() q: AnalyticsSeriesQuery): Promise<SalesReportDto> {
    return this.dashboards.sales(q.from, q.to, q.interval);
  }

  @Get('sensitivity')
  @Can('analytics.read')
  @ApiEndpoint({
    id: 'admin.analytics.sensitivity',
    summary: 'Price and lead-time sensitivity',
    description:
      'Drop-off after a price is shown: consented sessions shown a quote that did not add the product type to the cart, by lead-time band and by price quartile within product type × quantity band.',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Sensitivity',
    type: SensitivityReportDto,
    example: {
      byLeadTime: [{ band: '8-14', shown: 120, carted: 30, dropOffPct: '75.00' }],
      byPriceQuartile: [{ band: '1', shown: 60, carted: 20, dropOffPct: '66.67' }],
    },
  })
  @ApiStandardErrors('http.not_found', ...RANGE_ERRORS)
  sensitivity(@Query() q: AnalyticsProductTypeQuery): Promise<SensitivityReportDto> {
    return this.dashboards.sensitivity(q.from, q.to, q.productTypeId);
  }

  @Get('unmet-demand')
  @Can('analytics.read')
  @ApiEndpoint({
    id: 'admin.analytics.unmetDemand',
    summary: 'Unmet demand',
    description:
      'Declined / expired RFQs with their reason, calculations without an instant price (capability, capacity) by product type, spec band, quantity band and province, and the weeks a factory was fully booked (D-101). `priceGap`: quotations that ended above the customer’s target, only in cells with ≥ `analytics.target_price_min_group_size` distinct customers (D-252, D-190).',
    implements: [...DOCS, 'D-101', 'D-252', 'D-190'],
  })
  @ApiSuccess(200, {
    description: 'Unmet demand',
    type: UnmetDemandReportDto,
    example: {
      bySource: [{ key: 'rfq_declined', records: 4 }],
      byReason: [{ key: 'spec_not_feasible', records: 3 }],
      rows: [
        {
          productType: EXAMPLES.productType,
          source: 'rfq_declined',
          reasonCode: 'spec_not_feasible',
          specBand: 'W200-L300-H100',
          quantityBand: '1000-4999',
          province: EXAMPLES.province,
          records: 2,
        },
      ],
      capacityLimitedWeeks: [
        { productType: EXAMPLES.productType, weekStart: '2026-10-05', factories: 1, factoriesFull: 1 },
      ],
      priceGap: {
        minGroupSize: 5,
        rows: [
          {
            productType: EXAMPLES.productType,
            quantityBand: '1000-4999',
            priceGapBand: '10-25',
            records: 7,
            customers: 6,
          },
        ],
        suppressedRows: 3,
      },
    },
  })
  @ApiStandardErrors(...RANGE_ERRORS)
  unmet(@Query() q: AnalyticsRangeQuery): Promise<UnmetDemandReportDto> {
    return this.dashboards.unmetDemand(q.from, q.to);
  }

  @Get('factories')
  @Can('analytics.read', 'analytics.read_factories')
  @ApiEndpoint({
    id: 'admin.analytics.factories',
    summary: 'Factory utilisation and on-time rate',
    description:
      'Per factory and product type (staff-only, D-044): jobs released / accepted, acceptance within the SLA (D-074), shipping against the promise, liable claims and utilisation of weekly capacity (D-101).',
    implements: [...DOCS, 'D-044', 'D-074', 'D-101'],
  })
  @ApiSuccess(200, {
    description: 'Factories',
    type: [FactoryPerformanceDto],
    example: [
      {
        factory: EXAMPLES.factory,
        productType: EXAMPLES.productType,
        released: 12,
        accepted: 11,
        acceptedOnTimePct: '90.91',
        rejected: 1,
        shipped: 9,
        shippedOnTimePct: '88.89',
        claims: 1,
        utilisationPct: '64.50',
      },
    ],
  })
  @ApiStandardErrors(...RANGE_ERRORS)
  factories(@Query() q: AnalyticsRangeQuery): Promise<FactoryPerformanceDto[]> {
    return this.dashboards.factories(q.from, q.to);
  }

  @Get('campaigns')
  @Can('analytics.read')
  @ApiEndpoint({
    id: 'admin.analytics.campaigns',
    summary: 'Campaign performance',
    description:
      'Per campaign: redemptions and reversals, discount given and capped, order groups and their gross, first-time customers, budget and spend (D-053, D-154).',
    implements: [...DOCS, 'D-053', 'D-154'],
  })
  @ApiSuccess(200, {
    description: 'Campaigns',
    type: [CampaignPerformanceDto],
    example: [
      {
        id: EXAMPLES.ids.campaign,
        code: 'LAUNCH26',
        name: 'เปิดตัว getpack (fake)',
        status: 'active',
        budget: '50000.00',
        spent: '12500.00',
        redemptions: 40,
        reversals: 2,
        discountAmount: '12500.00',
        cappedAmount: '300.00',
        orderGroups: 38,
        grossAmount: '380000.00',
        newCustomers: 20,
      },
    ],
  })
  @ApiStandardErrors(...RANGE_ERRORS)
  campaigns(@Query() q: AnalyticsRangeQuery): Promise<CampaignPerformanceDto[]> {
    return this.dashboards.campaigns(q.from, q.to);
  }

  @Post('rollups')
  @Can('analytics.manage')
  @HttpCode(202)
  @ApiEndpoint({
    id: 'admin.analytics.queueRollups',
    summary: 'Queue a rollup backfill',
    description:
      'Rebuilds every fact of every day in the range (idempotent; at most 366 days); the worker picks them up within a minute — poll `GET /v1/admin/analytics/rollups`. The nightly run covers yesterday and the unpaid-expiry window (D-060).',
    implements: [...DOCS, 'D-060'],
  })
  @ApiBody({
    type: RollupRequestDto,
    examples: { default: { value: { from: '2026-10-01', to: '2026-10-31' } } },
  })
  @ApiAsync({ poll: 'admin.analytics.rollupRuns' })
  @ApiSuccess(202, { description: 'Queued', type: RollupQueuedDto, example: { queued: 372 } })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', ...RANGE_ERRORS)
  async queue(@CurrentActor() actor: Actor, @Body() body: RollupRequestDto): Promise<RollupQueuedDto> {
    this.dashboards.range(body.from, body.to);
    return { queued: await this.rollups.queue(body.from, body.to, staff(actor).userId) };
  }

  @Get('rollups')
  @Can('analytics.manage')
  @ApiEndpoint({
    id: 'admin.analytics.rollupRuns',
    summary: 'Rollup runs',
    description: 'Status of each fact job per day in the range, newest first.',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Runs',
    type: [RollupRunDto],
    example: [
      {
        job: 'fact_quotes',
        date: '2026-10-01',
        status: 'succeeded',
        rowCount: 18,
        error: null,
        attempts: 1,
        finishedAt: '2026-10-02T02:30:04+07:00',
      },
    ],
  })
  @ApiStandardErrors(...RANGE_ERRORS)
  async runs(@Query() q: AnalyticsRangeQuery): Promise<RollupRunDto[]> {
    this.dashboards.range(q.from, q.to);
    return (await this.rollups.runs(q.from, q.to)).map((r) => ({
      job: r.job,
      date: day(r.for_date),
      status: r.status,
      rowCount: r.row_count,
      error: r.error,
      attempts: r.attempts,
      finishedAt: r.finished_at ? toBangkokIso(r.finished_at) : null,
    }));
  }

  @Post('prospectus-exports')
  @Can('analytics.prospectus')
  @Idempotent()
  @HttpCode(202)
  @ApiEndpoint({
    id: 'admin.analytics.requestProspectus',
    summary: 'Request a partner prospectus',
    description:
      'Aggregated, anonymised demand evidence for recruiting factories (D-102): no customer identity, individual price or factory name; every figure backed by at least k contributors — `analytics.prospectus_min_group_size` (D-160, D-044) — with complementary suppression. The worker renders PDF + XLSX; poll `GET /v1/admin/analytics/prospectus-exports/{exportId}`. Audited export; requires `Idempotency-Key`.',
    implements: [...DOCS, 'D-044', 'D-160'],
  })
  @ApiBody({
    type: CreateProspectusDto,
    examples: { default: { value: { from: '2026-10-01', to: '2026-12-31' } } },
  })
  @ApiAsync({ poll: 'admin.analytics.getProspectus' })
  @ApiSuccess(202, {
    description: 'Queued',
    type: ProspectusExportDto,
    example: { ...PROSPECTUS_EXAMPLE, status: 'pending', suppressedCells: null, generatedAt: null },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', ...RANGE_ERRORS)
  async requestProspectus(
    @CurrentActor() actor: Actor,
    @Body() body: CreateProspectusDto,
  ): Promise<ProspectusExportDto> {
    this.dashboards.range(body.from, body.to);
    return prospectusDto(
      await this.prospectus.request(staff(actor), body.from, body.to, body.productTypeIds),
    );
  }

  @Get('prospectus-exports')
  @Can('analytics.prospectus')
  @ApiEndpoint({
    id: 'admin.analytics.listProspectus',
    summary: 'List partner prospectus exports',
    description: 'Newest first (50).',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Exports', type: [ProspectusExportDto], example: [PROSPECTUS_EXAMPLE] })
  @ApiStandardErrors()
  async listProspectus(): Promise<ProspectusExportDto[]> {
    return (await this.prospectus.list()).map(prospectusDto);
  }

  @Get('prospectus-exports/:exportId')
  @Can('analytics.prospectus')
  @ApiParam({ name: 'exportId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.analytics.getProspectus',
    summary: 'Get a partner prospectus export',
    description: '`pending` until the worker has rendered it.',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Export', type: ProspectusExportDto, example: PROSPECTUS_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async getProspectus(@Param('exportId', ParseUUIDPipe) exportId: string): Promise<ProspectusExportDto> {
    return prospectusDto(await this.prospectus.get(exportId));
  }

  @Get('prospectus-exports/:exportId/file')
  @Can('analytics.prospectus')
  @ApiParam({ name: 'exportId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.analytics.prospectusFile',
    summary: 'Download a partner prospectus',
    description: 'A 5-minute signed URL of the PDF or XLSX; each download is audited as an export (D-044).',
    implements: [...DOCS, 'D-044'],
  })
  @ApiSuccess(200, {
    description: 'Signed URL',
    type: DownloadUrlDto,
    example: {
      url: 'https://getpack-files.s3.example.com/…&X-Amz-Expires=300',
      expiresAt: '2027-01-05T09:06:10+07:00',
    },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'file.not_ready')
  async prospectusFile(
    @CurrentActor() actor: Actor,
    @Param('exportId', ParseUUIDPipe) exportId: string,
    @Query() q: ProspectusFileQuery,
  ): Promise<DownloadUrlDto> {
    const d = await this.files.downloadUrl(await this.prospectus.file(staff(actor), exportId, q.format));
    return { url: d.url, expiresAt: toBangkokIso(d.expiresAt) };
  }
}
