import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { type Prisma } from '@generated/prisma/client';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import { adminJobDto, type JobRow } from './job-views';
import { JobsQueryService } from './jobs-query.service';
import {
  ADMIN_JOB_EXAMPLE,
  AdminJobDto,
  JOB_IDS,
  JobListQuery,
  ReassignJobDto,
  StartProductionDto,
} from './production.dto';
import { ProductionService } from './production.service';

const jobParam = ApiParam({ name: 'jobId', format: 'uuid' });

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('admin', 'production')
@Controller()
export class AdminProductionController {
  constructor(
    private readonly production: ProductionService,
    private readonly jobs: JobsQueryService,
    private readonly permissions: PermissionResolver,
  ) {}

  private async dtos(actor: Actor, rows: JobRow[]) {
    const granted =
      actor.type === 'user' ? (await this.permissions.forUser(actor.userId)).permissions : new Set<string>();
    const photos = await this.jobs.photos(rows);
    return rows.map((r) =>
      adminJobDto(r, photos, { cost: granted.has('factory_cost.read'), margin: granted.has('margin.read') }),
    );
  }

  @Get('production-jobs')
  @Can('production.read')
  @ApiEndpoint({
    id: 'admin.production.list',
    summary: 'List production jobs',
    description:
      'Newest first; queues: `awaiting_acceptance` (released, not yet accepted), `escalated` (rejected or overdue ' +
      'with no factory to move to, D-074 / D-012), `at_risk` (predicted to miss the promised date). Buy prices ' +
      'only with `factory_cost.read` (D-141).',
    implements: ['D-073', 'D-074', 'D-141'],
  })
  @ApiPaginated(AdminJobDto, { example: ADMIN_JOB_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: JobListQuery) {
    const where: Prisma.ProductionJobWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.orderId && { order: { publicId: q.orderId } }),
      ...(q.queue === 'awaiting_acceptance' && { status: 'released' }),
      ...(q.queue === 'escalated' && {
        escalatedAt: { not: null },
        status: { in: ['released', 'rejected'] },
      }),
      ...(q.queue === 'at_risk' && {
        atRiskSince: { not: null },
        status: { in: ['accepted', 'in_progress', 'on_hold'] },
      }),
    };
    const [rows, total] = await this.jobs.list(actor, where, q.page, q.perPage);
    return { data: await this.dtos(actor, rows), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('production-jobs/:jobId')
  @Can('production.read')
  @jobParam
  @ApiEndpoint({
    id: 'admin.production.get',
    summary: 'Get a production job',
    description: 'With milestones, photos and assignment history (D-012).',
    implements: ['D-073', 'D-012'],
  })
  @ApiSuccess(200, { description: 'Job', type: AdminJobDto, example: ADMIN_JOB_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@CurrentActor() actor: Actor, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return (await this.dtos(actor, [await this.jobs.get(actor, jobId)]))[0]!;
  }

  @Post('orders/:orderId/actions/start-production')
  @HttpCode(200)
  @Can('production.start_manual')
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.production.startManually',
    summary: 'Start production as an exception',
    description:
      'Production normally starts by itself once the artwork is approved and the instalments required before ' +
      'production are paid (D-073). CS may start it earlier only as a documented exception — never before payment; ' +
      'the reason is audited.',
    implements: ['D-073'],
  })
  @ApiBody({
    type: StartProductionDto,
    examples: { default: { value: { reason: 'ลูกค้ายืนยันงานเร่งด่วน อนุมัติแบบทางโทรศัพท์แล้ว' } } },
  })
  @ApiSuccess(200, {
    description: 'Released',
    type: AdminJobDto,
    example: {
      ...ADMIN_JOB_EXAMPLE,
      releaseMode: 'manual_exception',
      releaseReason: 'ลูกค้ายืนยันงานเร่งด่วน',
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'production.already_released',
    'production.gate_closed',
    'numbering.series_missing',
  )
  async startManually(
    @CurrentActor() actor: Actor,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: StartProductionDto,
  ) {
    const job = await this.production.releaseManually(staff(actor), orderId, body.reason);
    return (await this.dtos(actor, [await this.jobs.get(actor, job.publicId)]))[0]!;
  }

  @Post('production-jobs/:jobId/actions/reassign')
  @HttpCode(200)
  @Can('production.manage')
  @jobParam
  @ApiEndpoint({
    id: 'admin.production.reassign',
    summary: 'Move a job to another factory',
    description:
      'For a released (not yet accepted) or rejected job: the new factory makes it at its own buy price while the ' +
      'customer price never changes, and only if the margin stays at or above the floor (D-012, 10 %, setting). ' +
      'Returns the new job.',
    implements: ['D-012', 'D-101'],
  })
  @ApiBody({
    type: ReassignJobDto,
    examples: { default: { value: { factoryId: JOB_IDS.factory, note: 'โรงงานเดิมเครื่องจักรเสีย' } } },
  })
  @ApiSuccess(200, { description: 'The new job', type: AdminJobDto, example: ADMIN_JOB_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'production.invalid_status',
    'production.factory_unavailable',
    'production.no_price_path',
    'production.below_margin_floor',
  )
  async reassign(
    @CurrentActor() actor: Actor,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() body: ReassignJobDto,
  ) {
    const moved = await this.production.reassign(staff(actor), jobId, body.factoryId, body.note);
    return (await this.dtos(actor, [await this.jobs.get(actor, moved.publicId)]))[0]!;
  }
}
