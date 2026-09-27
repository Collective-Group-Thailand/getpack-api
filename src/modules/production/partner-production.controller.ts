import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { type Prisma } from '@generated/prisma/client';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import { type JobRow, partnerJobDto } from './job-views';
import { JobsQueryService } from './jobs-query.service';
import { JobListQuery, PARTNER_JOB_EXAMPLE, PartnerJobDto, RejectJobDto } from './production.dto';
import { ProductionService } from './production.service';

export const jobParam = ApiParam({ name: 'jobId', format: 'uuid' });

/** The factory's side of production (partner surface, factory-scoped — other factories' jobs are 404). */
@ApiSurface('partner', 'production')
@Controller()
export class PartnerProductionController {
  constructor(
    private readonly production: ProductionService,
    private readonly jobs: JobsQueryService,
  ) {}

  private async dtos(rows: JobRow[]) {
    const photos = await this.jobs.photos(rows);
    return rows.map((r) => partnerJobDto(r, photos));
  }

  @Get('production-jobs')
  @Can('factory_jobs.read')
  @ApiEndpoint({
    id: 'partner.production.list',
    summary: 'List my factory’s jobs',
    description:
      'Newest first; `awaiting_acceptance` = released jobs to accept within 1 business day (D-074). No selling prices (D-142).',
    implements: ['D-074', 'D-142'],
  })
  @ApiPaginated(PartnerJobDto, { example: PARTNER_JOB_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: JobListQuery) {
    const where: Prisma.ProductionJobWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.queue === 'awaiting_acceptance' && { status: 'released' }),
      ...(q.queue === 'at_risk' && { atRiskSince: { not: null } }),
    };
    const [rows, total] = await this.jobs.list(actor, where, q.page, q.perPage);
    return { data: await this.dtos(rows), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('production-jobs/:jobId')
  @Can('factory_jobs.read')
  @jobParam
  @ApiEndpoint({
    id: 'partner.production.get',
    summary: 'Get one of my jobs',
    description:
      'Spec, the approved artwork and dieline (download the approved version only), delivery contacts (D-142), milestones.',
    implements: ['D-142', 'D-075'],
  })
  @ApiSuccess(200, { description: 'Job', type: PartnerJobDto, example: PARTNER_JOB_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@CurrentActor() actor: Actor, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return (await this.dtos([await this.jobs.get(actor, jobId)]))[0]!;
  }

  @Post('production-jobs/:jobId/actions/accept')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_jobs.respond')
  @jobParam
  @ApiEndpoint({
    id: 'partner.production.accept',
    summary: 'Accept a job',
    description:
      'Within 1 business day of release (D-074); books the load in the planned week (D-101). Counts for the scorecard (D-155).',
    implements: ['D-074', 'D-101', 'D-155'],
  })
  @ApiSuccess(200, {
    description: 'Accepted',
    type: PartnerJobDto,
    example: { ...PARTNER_JOB_EXAMPLE, status: 'accepted', acceptedAt: '2026-09-27T14:00:00+07:00' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'production.invalid_status')
  async accept(@CurrentActor() actor: Actor, @Param('jobId', ParseUUIDPipe) jobId: string) {
    const job = await this.jobs.get(actor, jobId);
    await this.production.accept(actor, job.id);
    return (await this.dtos([await this.jobs.get(actor, jobId)]))[0]!;
  }

  @Post('production-jobs/:jobId/actions/reject')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_jobs.respond')
  @jobParam
  @ApiEndpoint({
    id: 'partner.production.reject',
    summary: 'Reject a job with a reason',
    description:
      'Packio moves the job to another factory when one keeps the margin floor (D-012, D-101) or escalates it; ' +
      'the customer price never changes. Counts in the scorecard.',
    implements: ['D-012', 'D-074'],
  })
  @ApiBody({
    type: RejectJobDto,
    examples: { default: { value: { reasonCode: 'capacity', note: 'คิวเต็มถึงสิ้นเดือน' } } },
  })
  @ApiSuccess(200, {
    description: 'Rejected',
    type: PartnerJobDto,
    example: { ...PARTNER_JOB_EXAMPLE, status: 'rejected' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'production.invalid_status',
  )
  async reject(
    @CurrentActor() actor: Actor,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() body: RejectJobDto,
  ) {
    const job = await this.jobs.get(actor, jobId);
    await this.production.reject(actor, job.id, body.reasonCode, body.note ?? null);
    return (await this.dtos([await this.jobs.get(actor, jobId)]))[0]!;
  }
}
