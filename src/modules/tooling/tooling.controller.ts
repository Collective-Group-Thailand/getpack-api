import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { JobsQueryService } from '@modules/production/jobs-query.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  AdminToolingQuery,
  REMAKE_EXAMPLE,
  ReportToolingUnusableDto,
  TOOLING_EXAMPLE,
  ToolingItemDto,
  ToolingRemakeDto,
} from './tooling.dto';
import { ToolingService } from './tooling.service';

const DECISIONS = ['D-289', 'D-205'];
const factoryParam = ApiParam({ name: 'factoryId', format: 'uuid' });
const jobParam = ApiParam({ name: 'jobId', format: 'uuid' });

@ApiSurface('admin', 'tooling')
@Controller('tooling')
export class AdminToolingController {
  constructor(private readonly tooling: ToolingService) {}

  @Get()
  @Can('production.read')
  @ApiEndpoint({
    id: 'admin.tooling.list',
    summary: 'List the tooling register',
    description:
      'Plates and die blocks a delivered order paid for or reused, kept at the factory that made them (D-205): ' +
      'plates bound to the specification and the approved artwork, a die block to the specification; reusable until ' +
      'last use + `tooling.reuse_months` (D-289). Most recently used first; filter by factory, kind and status.',
    implements: DECISIONS,
  })
  @ApiPaginated(ToolingItemDto, { example: TOOLING_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() query: AdminToolingQuery) {
    const { rows, total } = await this.tooling.list(query);
    return { data: rows, meta: { page: query.page, perPage: query.perPage, total } };
  }
}

@ApiSurface('partner', 'tooling')
@Controller()
export class PartnerToolingController {
  constructor(
    private readonly tooling: ToolingService,
    private readonly jobs: JobsQueryService,
  ) {}

  @Get('factories/:factoryId/tooling')
  @Can('factory_jobs.read')
  @factoryParam
  @ApiEndpoint({
    id: 'partner.tooling.list',
    summary: 'List my factory’s tooling register',
    description:
      'The plates and die blocks my factory keeps for getpack orders (D-205, own factory only, D-044), with the last ' +
      'use and until when a reorder reuses them without a new charge (D-289).',
    implements: [...DECISIONS, 'D-044'],
  })
  @ApiSuccess(200, { description: 'Register', type: [ToolingItemDto], example: [TOOLING_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  list(@CurrentActor() actor: Actor, @Param('factoryId', ParseUUIDPipe) factoryId: string) {
    return this.tooling.listForFactory(actor, factoryId);
  }

  @Get('production-jobs/:jobId/tooling')
  @Can('factory_jobs.read')
  @jobParam
  @ApiEndpoint({
    id: 'partner.tooling.listForJob',
    summary: 'List the tooling a job reuses',
    description:
      'The register entries whose plates / die block this job’s order reuses and was not charged for (D-289). ' +
      'Check them before accepting: one that cannot be used is reported, not accepted silently (D-205).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Reused tooling', type: [ToolingItemDto], example: [TOOLING_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async listForJob(@CurrentActor() actor: Actor, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.tooling.forJob(await this.jobs.get(actor, jobId));
  }

  @Post('production-jobs/:jobId/actions/report-tooling-unusable')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_jobs.respond')
  @jobParam
  @ApiBody({
    type: ReportToolingUnusableDto,
    examples: {
      default: { value: { toolingId: REMAKE_EXAMPLE.toolingId, reason: REMAKE_EXAMPLE.reason } },
    },
  })
  @ApiEndpoint({
    id: 'partner.tooling.reportUnusable',
    summary: 'Report a reused tool unusable',
    description:
      'Before accepting a job (status `released`), the factory reports that a plate set or die block the order reuses ' +
      'cannot be used. getpack absorbs the remake: its buy price as waived in the quotation is paid with the job’s ' +
      'goods receipt (the purchase order keeps its snapshot); the customer price does not change (D-205, D-012). The tool is unusable until the remade one ' +
      'is delivered. Once per tool and job.',
    implements: [...DECISIONS, 'D-012'],
  })
  @ApiSuccess(200, { description: 'Remake recorded', type: ToolingRemakeDto, example: REMAKE_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'production.invalid_status',
    'tooling.already_reported',
  )
  async reportUnusable(
    @CurrentActor() actor: Actor,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() body: ReportToolingUnusableDto,
  ) {
    const job = await this.jobs.get(actor, jobId);
    return this.tooling.reportUnusable(actor, job.id, body);
  }
}
