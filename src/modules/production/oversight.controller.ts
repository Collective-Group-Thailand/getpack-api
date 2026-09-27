import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { toBangkokIso } from '@common/time/bangkok';
import { FactoryAccess } from '@modules/partners/factories/factory-access';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  INSPECTION_EXAMPLE,
  InspectionDto,
  InspectionListQuery,
  RecomputeScorecardDto,
  RecordInspectionDto,
  ScheduleInspectionDto,
  SCORECARD_EXAMPLE,
  ScorecardDto,
} from './production.dto';
import { ProductionOversightService } from './production-oversight.service';

type InspectionRow = Awaited<ReturnType<ProductionOversightService['listInspections']>>[0][number];
const factoryParam = ApiParam({ name: 'factoryId', format: 'uuid' });
const inspectionParam = ApiParam({ name: 'inspectionId', format: 'uuid' });

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

function inspectionDto(i: InspectionRow): InspectionDto {
  return {
    id: i.publicId,
    jobId: i.job.publicId,
    jobNo: i.job.jobNo,
    factoryCode: i.job.factory.code,
    status: i.status,
    reasons: i.reasons,
    ratePct: i.ratePct.toFixed(4),
    selected: i.selected,
    lotSize: i.lotSize,
    sampleSize: i.sampleSize,
    accept: { critical: i.acceptCritical, major: i.acceptMajor, minor: i.acceptMinor },
    found:
      i.foundCritical === null
        ? null
        : { critical: i.foundCritical, major: i.foundMajor ?? 0, minor: i.foundMinor ?? 0 },
    scheduledAt: i.scheduledAt ? toBangkokIso(i.scheduledAt) : null,
    inspector: i.inspector?.displayName ?? null,
    resultAt: i.resultAt ? toBangkokIso(i.resultAt) : null,
    notes: i.notes,
  };
}

export function scorecardDto(s: {
  month: Date;
  onTimeAcceptancePct: { toFixed(n: number): string } | null;
  onTimeShippingPct: { toFixed(n: number): string } | null;
  qcFirstPassPct: { toFixed(n: number): string } | null;
  claimRatePct: { toFixed(n: number): string } | null;
  onTimeUpdatesPct: { toFixed(n: number): string } | null;
  jobsCount: number;
  computedAt: Date;
}): ScorecardDto {
  const f = (v: { toFixed(n: number): string } | null) => v?.toFixed(4) ?? null;
  return {
    month: s.month.toISOString().slice(0, 10),
    onTimeAcceptancePct: f(s.onTimeAcceptancePct),
    onTimeShippingPct: f(s.onTimeShippingPct),
    qcFirstPassPct: f(s.qcFirstPassPct),
    claimRatePct: f(s.claimRatePct),
    onTimeUpdatesPct: f(s.onTimeUpdatesPct),
    jobsCount: s.jobsCount,
    computedAt: toBangkokIso(s.computedAt),
  };
}

@ApiSurface('admin', 'inspections')
@Controller()
export class AdminOversightController {
  constructor(
    private readonly oversight: ProductionOversightService,
    private readonly access: FactoryAccess,
  ) {}

  private async one(publicId: string) {
    const [rows] = await this.oversight.listInspections({ publicId }, 1, 1);
    if (!rows[0]) throw new DomainException('http.not_found');
    return inspectionDto(rows[0]);
  }

  @Get('inspections')
  @Can('production.read')
  @ApiEndpoint({
    id: 'admin.inspections.list',
    summary: 'List Packio inspections',
    description:
      'Planned at release from the risk rules (D-076: value ≥ THB 300,000 → 100 %, 100,000–299,999 → 20 %, the ' +
      'first 3 jobs of a factory → 100 %, a factory above 3 % defects over 90 days → 50 %, special finishes or ' +
      'food contact +20 pp) with an ISO 2859-1 level II sample; `waived` = not drawn.',
    implements: ['D-076'],
  })
  @ApiPaginated(InspectionDto, { example: INSPECTION_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: InspectionListQuery) {
    const [rows, total] = await this.oversight.listInspections(
      q.status ? { status: q.status } : {},
      q.page,
      q.perPage,
    );
    return { data: rows.map(inspectionDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Post('inspections/:inspectionId/actions/schedule')
  @HttpCode(200)
  @Can('inspections.perform')
  @inspectionParam
  @ApiEndpoint({
    id: 'admin.inspections.schedule',
    summary: 'Schedule an inspection',
    description: 'Inspector and date (D-076).',
    implements: ['D-076'],
  })
  @ApiBody({
    type: ScheduleInspectionDto,
    examples: { default: { value: { scheduledAt: '2026-10-08T10:00:00+07:00' } } },
  })
  @ApiSuccess(200, {
    description: 'Scheduled',
    type: InspectionDto,
    example: { ...INSPECTION_EXAMPLE, scheduledAt: '2026-10-08T10:00:00+07:00', inspector: 'ผู้ตรวจ ทดสอบ' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'production.invalid_status',
  )
  async schedule(
    @CurrentActor() actor: Actor,
    @Param('inspectionId', ParseUUIDPipe) id: string,
    @Body() body: ScheduleInspectionDto,
  ) {
    await this.oversight.schedule(staff(actor), id, {
      inspectorUserId: body.inspectorUserId,
      scheduledAt: new Date(body.scheduledAt),
    });
    return this.one(id);
  }

  @Post('inspections/:inspectionId/actions/record')
  @HttpCode(200)
  @Can('inspections.perform')
  @inspectionParam
  @ApiEndpoint({
    id: 'admin.inspections.record',
    summary: 'Record an inspection result',
    description:
      'Defects found in the sample per class; passed when each is within its acceptance number (AQL 0 / 2.5 / 4.0, ' +
      'ISO 2859-1). A failure puts the job on hold for a decision. Feeds the scorecard (D-076, D-155).',
    implements: ['D-076', 'D-155'],
  })
  @ApiBody({
    type: RecordInspectionDto,
    examples: {
      default: { value: { foundCritical: 0, foundMajor: 1, foundMinor: 2, notes: 'สุ่มตรวจ 80 ชิ้น' } },
    },
  })
  @ApiSuccess(200, {
    description: 'Recorded',
    type: InspectionDto,
    example: { ...INSPECTION_EXAMPLE, status: 'passed', found: { critical: 0, major: 1, minor: 2 } },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'production.invalid_status',
    'artwork.file_not_usable',
  )
  async record(
    @CurrentActor() actor: Actor,
    @Param('inspectionId', ParseUUIDPipe) id: string,
    @Body() body: RecordInspectionDto,
  ) {
    await this.oversight.recordResult(staff(actor), id, body);
    return this.one(id);
  }

  @Get('factories/:factoryId/scorecards')
  @Can('production.read')
  @factoryParam
  @ApiEndpoint({
    id: 'admin.inspections.scorecards',
    summary: 'A factory’s monthly scorecards',
    description: 'Latest 12 months (D-155).',
    implements: ['D-155'],
  })
  @ApiSuccess(200, { description: 'Scorecards', type: [ScorecardDto], example: [SCORECARD_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async scorecards(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    const factory = await this.access.factory(actor, factoryId);
    return (await this.oversight.scorecards(factory.id)).map(scorecardDto);
  }

  @Post('factories/:factoryId/scorecards/actions/recompute')
  @HttpCode(200)
  @Can('production.manage')
  @factoryParam
  @ApiEndpoint({
    id: 'admin.inspections.recomputeScorecard',
    summary: 'Recompute a month’s scorecard',
    description: 'After corrections; the monthly job computes last month on the 1st (D-155).',
    implements: ['D-155'],
  })
  @ApiBody({ type: RecomputeScorecardDto, examples: { default: { value: { month: '2026-09-01' } } } })
  @ApiSuccess(200, { description: 'Scorecard', type: ScorecardDto, example: SCORECARD_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  async recompute(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
    @Body() body: RecomputeScorecardDto,
  ) {
    const factory = await this.access.factory(actor, factoryId);
    return scorecardDto(await this.oversight.recompute(actor, factory.id, body.month));
  }
}

@ApiSurface('partner', 'production')
@Controller()
export class PartnerScorecardsController {
  constructor(
    private readonly oversight: ProductionOversightService,
    private readonly access: FactoryAccess,
  ) {}

  @Get('factories/:factoryId/scorecards')
  @Can('factory_scorecard.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.production.scorecards',
    summary: 'My factory’s monthly scorecards',
    description:
      'On-time acceptance, on-time shipping, QC first pass, claim rate and on-time updates (D-155); used in allocation when several factories serve a type (D-075).',
    implements: ['D-155', 'D-075'],
  })
  @ApiSuccess(200, { description: 'Scorecards', type: [ScorecardDto], example: [SCORECARD_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async scorecards(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    const factory = await this.access.factory(actor, factoryId);
    return (await this.oversight.scorecards(factory.id)).map(scorecardDto);
  }
}
