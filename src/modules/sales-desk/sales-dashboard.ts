import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { addCalendarDays, bangkokDate, startOfBangkokDay, toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DownloadUrlDto } from '@platform/files/files.dto';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';

import { SalesCsvService } from './sales-csv.service';
import {
  buildDashboard,
  type Dashboard,
  dashboardCsv,
  FUNNEL_STAGES,
  type Period,
  PERIODS,
} from './sales-dashboard-rules';
import { AGENT_KIND_FILTERS, P4_IDS } from './sales-pipeline.dto';
import { staffActor } from './sales-scope';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DECISIONS = ['D-469'];

export class SalesDashboardQuery {
  @ApiPropertyOptional({ example: '2026-08-01', description: 'First Bangkok day (default: 90 days ago)' })
  @IsOptional()
  @Matches(DAY)
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-03', description: 'Last Bangkok day, inclusive (default: today)' })
  @IsOptional()
  @Matches(DAY)
  to?: string;

  @ApiPropertyOptional({ enum: PERIODS, enumName: 'SalesDashboardPeriod', default: 'week' })
  @IsOptional()
  @IsIn(PERIODS)
  period?: Period;

  @ApiPropertyOptional({
    enum: AGENT_KIND_FILTERS,
    enumName: 'SalesAgentKindFilter',
    description: 'Only company reps or only freelance agents (default both)',
  })
  @IsOptional()
  @IsIn(AGENT_KIND_FILTERS)
  agentKind?: (typeof AGENT_KIND_FILTERS)[number];

  @ApiPropertyOptional({ format: 'uuid', description: 'One agent / rep only' })
  @IsOptional()
  @IsUUID()
  agentId?: string;
}

class WinFigures {
  @ApiProperty({ example: 24 }) leads!: number;
  @ApiProperty({ example: 6 }) won!: number;
  @ApiProperty({ example: 4 }) lost!: number;
  @ApiProperty({ type: String, nullable: true, example: '60.0', description: 'won ÷ (won + lost), %' })
  winRatePct!: string | null;
}

export class SalesDashboardTotalsDto extends WinFigures {
  @ApiProperty({ example: '480000.00', description: 'Σ expected value of open leads (THB)' })
  openValue!: string;
}

export class SalesFunnelStepDto {
  @ApiProperty({ enum: FUNNEL_STAGES, enumName: 'SalesFunnelStage', example: 'quoted' })
  stage!: string;
  @ApiProperty({ example: 12, description: 'Leads that reached this stage (or further)' })
  count!: number;
  @ApiProperty({
    type: String,
    nullable: true,
    example: '25.0',
    description: 'Lost from the previous step, %',
  })
  dropOffPct!: string | null;
}

export class SalesStageDaysDto {
  @ApiProperty({
    enum: ['new', 'contacted', 'quoted', 'negotiating'],
    enumName: 'SalesOpenStage',
    example: 'quoted',
  })
  stage!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    example: '3.5',
    description: 'Median days spent in the stage',
  })
  medianDays!: string | null;
  @ApiProperty({ example: 10, description: 'Stage exits measured' })
  samples!: number;
}

export class SalesSourceFiguresDto extends WinFigures {
  @ApiProperty({ example: 'manual', description: 'Lead source (`AgentLeadSource`) or inbound source' })
  source!: string;
  @ApiProperty({ example: 5, description: 'Inbound enquiries of that source in the period' })
  inbound!: number;
}

export class SalesRepFiguresDto extends SalesDashboardTotalsDto {
  @ApiProperty({ format: 'uuid', example: P4_IDS.rep, description: 'The rep’s employee agent' })
  agentId!: string;
  @ApiProperty({ example: 'สมหญิง ขายดี' })
  name!: string;
}

export class SalesPeriodFiguresDto {
  @ApiProperty({
    example: '2026-11',
    description: 'The month (`YYYY-MM`) or week (its Monday, `YYYY-MM-DD`), Bangkok',
  })
  period!: string;
  @ApiProperty({ example: 8, description: 'Leads created' })
  leads!: number;
  @ApiProperty({ example: 2, description: 'Leads won' })
  won!: number;
}

export class SalesKindFiguresDto extends SalesDashboardTotalsDto {
  @ApiProperty({ enum: AGENT_KIND_FILTERS, enumName: 'SalesAgentKindFilter', example: 'employee' })
  agentKind!: string;
}

export class SalesInboundFiguresDto {
  @ApiProperty({ example: 30 }) total!: number;
  @ApiProperty({
    type: String,
    nullable: true,
    example: '86.7',
    description: 'Answered within the first-response time ÷ enquiries due, % (P-05)',
  })
  firstResponseSlaPct!: string | null;
}

export class SalesDashboardDto {
  @ApiProperty({ format: 'date', example: '2026-08-05' }) from!: string;
  @ApiProperty({ format: 'date', example: '2026-11-03' }) to!: string;
  @ApiProperty({ enum: PERIODS, enumName: 'SalesDashboardPeriod', example: 'week' }) period!: string;
  @ApiProperty({ format: 'date-time', example: '2026-11-03T10:00:00+07:00' }) asOf!: string;
  @ApiProperty({ type: SalesDashboardTotalsDto }) totals!: SalesDashboardTotalsDto;
  @ApiProperty({ type: [SalesFunnelStepDto] }) funnel!: SalesFunnelStepDto[];
  @ApiProperty({ type: [SalesStageDaysDto] }) medianDays!: SalesStageDaysDto[];
  @ApiProperty({ type: [SalesSourceFiguresDto] }) bySource!: SalesSourceFiguresDto[];
  @ApiProperty({ type: [SalesRepFiguresDto] }) byRep!: SalesRepFiguresDto[];
  @ApiProperty({ type: [SalesPeriodFiguresDto] }) byPeriod!: SalesPeriodFiguresDto[];
  @ApiProperty({ type: [SalesKindFiguresDto] }) split!: SalesKindFiguresDto[];
  @ApiProperty({ type: SalesInboundFiguresDto }) inbound!: SalesInboundFiguresDto;
}

const DASHBOARD_EXAMPLE: SalesDashboardDto = {
  from: '2026-08-05',
  to: '2026-11-03',
  period: 'week',
  asOf: '2026-11-03T10:00:00+07:00',
  totals: { leads: 24, won: 6, lost: 4, winRatePct: '60.0', openValue: '480000.00' },
  funnel: [
    { stage: 'new', count: 24, dropOffPct: null },
    { stage: 'contacted', count: 20, dropOffPct: '16.7' },
    { stage: 'quoted', count: 14, dropOffPct: '30.0' },
    { stage: 'negotiating', count: 8, dropOffPct: '42.9' },
    { stage: 'won', count: 6, dropOffPct: '25.0' },
  ],
  medianDays: [{ stage: 'quoted', medianDays: '3.5', samples: 10 }],
  bySource: [{ source: 'manual', leads: 10, won: 3, lost: 1, winRatePct: '75.0', inbound: 0 }],
  byRep: [
    {
      agentId: P4_IDS.rep,
      name: 'สมหญิง ขายดี',
      leads: 12,
      won: 4,
      lost: 2,
      winRatePct: '66.7',
      openValue: '240000.00',
    },
  ],
  byPeriod: [{ period: '2026-11', leads: 8, won: 2 }],
  split: [
    { agentKind: 'employee', leads: 16, won: 5, lost: 3, winRatePct: '62.5', openValue: '320000.00' },
    { agentKind: 'freelance', leads: 8, won: 1, lost: 1, winRatePct: '50.0', openValue: '160000.00' },
  ],
  inbound: { total: 30, firstResponseSlaPct: '86.7' },
};

/** D-469 item 5: the data behind the manager dashboard (leads created in the range). */
@Injectable()
export class SalesDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async build(
    q: SalesDashboardQuery,
    now = new Date(),
  ): Promise<{ range: { from: string; to: string }; d: Dashboard }> {
    const to = q.to ?? bangkokDate(now);
    const from = q.from ?? addCalendarDays(to, -89);
    const start = startOfBangkokDay(from);
    const end = startOfBangkokDay(addCalendarDays(to, 1));
    const where: Prisma.SalesAgentLeadWhereInput = {
      kind: 'customer',
      createdAt: { gte: start, lt: end },
      ...((q.agentKind || q.agentId) && {
        agent: { ...(q.agentKind && { kind: q.agentKind }), ...(q.agentId && { publicId: q.agentId }) },
      }),
    };
    const leads = await this.prisma.salesAgentLead.findMany({
      where,
      select: {
        id: true,
        agentId: true,
        stage: true,
        source: true,
        createdAt: true,
        wonAt: true,
        expectedValue: true,
        agent: { select: { kind: true } },
      },
    });
    const ids = leads.map((l) => l.id);
    const changes = ids.length
      ? await this.prisma.salesAgentLeadActivity.findMany({
          where: { leadId: { in: ids }, kind: { in: ['stage_change', 'system', 'quote_sent'] } },
          select: { leadId: true, data: true, occurredAt: true },
        })
      : [];
    const agents = await this.prisma.salesAgent.findMany({
      where: { kind: 'employee', ...(q.agentId && { publicId: q.agentId }) },
      select: { id: true, publicId: true, legalName: true },
    });
    const inbound = await this.prisma.salesInboundLead.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: { source: true, firstResponseDueAt: true, firstRespondedAt: true },
    });
    const d = buildDashboard({
      leads: leads.map((l) => ({
        id: l.id,
        agentId: l.agentId,
        agentKind: l.agent.kind,
        stage: l.stage,
        source: l.source,
        createdAt: l.createdAt,
        wonAt: l.wonAt,
        expectedValue: l.expectedValue?.toFixed(2) ?? null,
      })),
      changes: changes.flatMap((c) => {
        const to = (c.data as Record<string, unknown> | null)?.['to'];
        return typeof to === 'string' ? [{ leadId: c.leadId, to, at: c.occurredAt }] : [];
      }),
      reps:
        q.agentKind === 'freelance'
          ? []
          : agents.map((a) => ({ agentId: a.id, agentPublicId: a.publicId, name: a.legalName })),
      inbound: inbound.map((i) => ({
        source: i.source,
        due: i.firstResponseDueAt,
        respondedAt: i.firstRespondedAt,
      })),
      period: q.period ?? 'week',
      now,
    });
    return { range: { from, to }, d };
  }
}

/** D-469 item 5: the sales manager's dashboard and its CSV. */
@ApiSurface('admin', 'sales')
@Controller('sales')
export class AdminSalesDashboardController {
  constructor(
    private readonly dashboard: SalesDashboardService,
    private readonly csv: SalesCsvService,
  ) {}

  @Get('dashboard')
  @Can('sales.pipeline.manage')
  @ApiEndpoint({
    id: 'admin.sales.dashboard',
    summary: 'Read the sales dashboard',
    description:
      'Leads created in the range (Bangkok days, default the last 90): funnel by stage with drop-off, win rate, ' +
      'median days per stage (from the timeline’s stage changes), by source, by rep, by week or month, the inbound ' +
      'first-response SLA % (P-05) and freelance vs employee. Every figure is computed by the API (D-469).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Dashboard', type: SalesDashboardDto, example: DASHBOARD_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async get(@Query() q: SalesDashboardQuery): Promise<SalesDashboardDto> {
    const now = new Date();
    const { range, d } = await this.dashboard.build(q, now);
    return { ...range, period: q.period ?? 'week', asOf: toBangkokIso(now), ...d };
  }

  @Get('dashboard/export')
  @Can('sales.pipeline.manage')
  @ApiEndpoint({
    id: 'admin.sales.exportDashboard',
    summary: 'Export the sales dashboard as CSV',
    description:
      'The same figures as `admin.sales.dashboard` as a UTF-8 CSV (one section per block, formula-safe cells) ' +
      'behind a 5-minute link; audited as an export. No cost or margin is in it (D-469).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Download link',
    type: DownloadUrlDto,
    example: { url: 'https://getpack-files.s3.example.com/…', expiresAt: '2026-11-03T10:05:00+07:00' },
  })
  @ApiStandardErrors('validation.failed')
  async export(@CurrentActor() actor: Actor, @Query() q: SalesDashboardQuery): Promise<DownloadUrlDto> {
    const { d } = await this.dashboard.build(q);
    const { url, expiresAt } = await this.csv.publish(staffActor(actor), 'sales-dashboard', dashboardCsv(d), {
      kind: 'sales_dashboard',
      resourceType: 'sales_dashboard',
      rows: d.totals.leads,
    });
    return { url, expiresAt: toBangkokIso(expiresAt) };
  }
}
