import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBody, ApiProperty } from '@nestjs/swagger';
import { AuditExportDto } from '@platform/audit/audit.controller';
import { IsIn, Matches } from 'class-validator';

import { JOURNEYS } from './journeys';
import { JourneysService } from './journeys.service';

const JOURNEY_KEYS = JOURNEYS.map((j) => j.key);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class JourneysQuery {
  @ApiProperty({ example: '2026-10-01', description: 'First Bangkok day' })
  @Matches(DAY)
  from!: string;

  @ApiProperty({ example: '2026-10-31', description: 'Last Bangkok day (at most 400 days)' })
  @Matches(DAY)
  to!: string;
}

export class ExportJourneysDto extends JourneysQuery {
  @ApiProperty({ enum: ['xlsx', 'csv'], enumName: 'ReportFormat', example: 'xlsx' })
  @IsIn(['xlsx', 'csv'])
  format!: 'xlsx' | 'csv';
}

export class JourneyStepCountDto {
  @ApiProperty({ example: 'started' })
  step!: string;

  @ApiProperty({
    type: 'integer',
    example: 420,
    description: 'Consented sessions that reached it (summed per day)',
  })
  sessions!: number;

  @ApiProperty({ type: String, nullable: true, example: '62.50', description: '% of the previous step' })
  fromPreviousPct!: string | null;
}

export class JourneyFunnelDto {
  @ApiProperty({ enum: JOURNEY_KEYS, enumName: 'ScorecardJourney', example: 'studio' })
  journey!: string;

  @ApiProperty({ example: 'T2', description: 'The scorecard task (`docs/ux/competitive-scorecard.md` §2)' })
  task!: string;

  @ApiProperty({ type: [JourneyStepCountDto] })
  steps!: JourneyStepCountDto[];

  @ApiProperty({ type: String, nullable: true, example: '18.10', description: 'Last step ÷ first step, %' })
  conversionPct!: string | null;
}

export class JourneyWeekCheckDto {
  @ApiProperty({ format: 'date', example: '2026-09-28', description: 'Monday of the checked week' })
  weekStart!: string;

  @ApiProperty({ enum: JOURNEY_KEYS, enumName: 'ScorecardJourney', example: 'studio' })
  journey!: string;

  @ApiProperty({ type: 'integer', example: 400 })
  firstSessions!: number;

  @ApiProperty({ type: 'integer', example: 60 })
  lastSessions!: number;

  @ApiProperty({ type: 'integer', example: 380 })
  previousFirstSessions!: number;

  @ApiProperty({ type: 'integer', example: 80 })
  previousLastSessions!: number;

  @ApiProperty({ type: String, nullable: true, example: '15.00' })
  conversionPct!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '21.05' })
  previousConversionPct!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '28.75',
    description: 'Relative fall of the conversion, %',
  })
  dropPct!: string | null;

  @ApiProperty({
    example: true,
    description: 'Fell more than the threshold with enough sessions — ops was alerted',
  })
  alert!: boolean;
}

export class JourneysReportDto extends JourneysQuery {
  @ApiProperty({ type: [JourneyFunnelDto], description: 'Every journey, in scorecard order' })
  journeys!: JourneyFunnelDto[];

  @ApiProperty({ type: [JourneyWeekCheckDto], description: 'The latest Monday week-over-week check' })
  weekChecks!: JourneyWeekCheckDto[];
}

const EXAMPLE: JourneysReportDto = {
  from: '2026-10-01',
  to: '2026-10-31',
  journeys: [
    {
      journey: 'studio',
      task: 'T2',
      steps: [
        { step: 'started', sessions: 420, fromPreviousPct: null },
        { step: 'box_confirmed', sessions: 300, fromPreviousPct: '71.43' },
        { step: 'first_artwork', sessions: 180, fromPreviousPct: '60.00' },
        { step: 'added_to_cart', sessions: 76, fromPreviousPct: '42.22' },
      ],
      conversionPct: '18.10',
    },
  ],
  weekChecks: [
    {
      weekStart: '2026-09-28',
      journey: 'studio',
      firstSessions: 400,
      lastSessions: 60,
      previousFirstSessions: 380,
      previousLastSessions: 80,
      conversionPct: '15.00',
      previousConversionPct: '21.05',
      dropPct: '28.75',
      alert: true,
    },
  ],
};

@ApiSurface('admin', 'analytics')
@Controller('analytics/journeys')
export class AdminJourneysController {
  constructor(private readonly journeys: JourneysService) {}

  @Get()
  @Can('analytics.read')
  @ApiEndpoint({
    id: 'admin.analytics.journeys',
    summary: 'Scorecard journey funnels',
    description:
      'Per scorecard journey (discovery → price, studio, checks, order, sample, target price, tracking, reorder, ' +
      'claim, documents, dieline): consented sessions per step over the Bangkok days and the conversion, from the ' +
      'nightly journey facts; and the latest Monday check of last week against the week before — a fall of more ' +
      'than `analytics.journey_drop_alert_pct` with at least `analytics.journey_alert_min_sessions` sessions both ' +
      'weeks raises ops signal `journey_conversion_drops` (D-303). Aggregates only.',
    implements: ['D-303', 'D-217', 'D-102'],
  })
  @ApiSuccess(200, { description: 'Report', type: JourneysReportDto, example: EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async report(@Query() q: JourneysQuery): Promise<JourneysReportDto> {
    return {
      from: q.from,
      to: q.to,
      journeys: await this.journeys.funnels(q.from, q.to),
      weekChecks: await this.journeys.weekChecks(),
    };
  }

  @Post('actions/export')
  @HttpCode(200)
  @Can('analytics.read', 'reports.export')
  @ApiEndpoint({
    id: 'admin.analytics.exportJourneys',
    summary: 'Export journey steps for a scorecard round',
    description:
      'Day × journey × step session counts as XLSX or CSV (D-303, D-217): aggregates only — no session, visitor or ' +
      'customer, a cell under `analytics.prospectus_min_group_size` sessions suppressed (D-160) — served by a ' +
      '5-minute signed URL; audited (`export.generated`).',
    implements: ['D-303', 'D-217', 'D-160'],
  })
  @ApiBody({
    type: ExportJourneysDto,
    examples: { default: { value: { from: '2026-10-01', to: '2026-10-31', format: 'xlsx' } } },
  })
  @ApiSuccess(200, {
    description: 'Export ready',
    type: AuditExportDto,
    example: {
      fileId: '0192f3a0-7c1e-7d2a-9b1f-0000000e7501',
      url: 'https://packio-files.s3.example.com/…&X-Amz-Expires=300',
      rows: 330,
      truncated: false,
      expiresAt: '2026-10-01T10:05:00+07:00',
    },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
  export(@CurrentActor() actor: Actor, @Body() body: ExportJourneysDto) {
    if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
    return this.journeys.export(actor, body.from, body.to, body.format);
  }
}
