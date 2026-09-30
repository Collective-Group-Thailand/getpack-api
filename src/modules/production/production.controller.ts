import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { toBangkokIso } from '@common/time/bangkok';
import { type Prisma } from '@generated/prisma/client';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import { adminJobDto, issueDto, type JobRow, qcDto } from './job-views';
import { JobsQueryService } from './jobs-query.service';
import { MilestoneRoutesService, type RouteRow } from './milestone-routes.service';
import { MilestonesService } from './milestones.service';
import {
  ADD_ROUTE_VERSION_EXAMPLE,
  AddRouteVersionDto,
  ADMIN_JOB_EXAMPLE,
  AdminJobDto,
  CreateMilestoneRouteDto,
  HoldJobDto,
  ISSUE_EXAMPLE,
  JOB_IDS,
  JobIssueDto,
  JobListQuery,
  MilestoneRouteDto,
  ProductionBoardDto,
  ProductionBoardQuery,
  QC_EXAMPLE,
  QcCheckDto,
  ReassignJobDto,
  ResolveIssueDto,
  ROUTE_EXAMPLE,
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
    private readonly milestones: MilestonesService,
  ) {}

  private async dtos(actor: Actor, rows: JobRow[]) {
    const granted =
      actor.type === 'user' ? (await this.permissions.forUser(actor.userId)).permissions : new Set<string>();
    const photos = await this.jobs.photos(rows);
    return rows.map((r) =>
      adminJobDto(r, photos, { cost: granted.has('factory_cost.read'), margin: granted.has('margin.read') }),
    );
  }

  @Get('production-board')
  @Can('production.read')
  @ApiEndpoint({
    id: 'admin.production.board',
    summary: 'The production board',
    description:
      'Open jobs grouped by the step they are at (released, not accepted yet: `awaiting_acceptance`) with totals ' +
      'and the ones predicted to miss the promised date (D-074, D-075); filter by factory and product type. ' +
      'The jobs of a column: `admin.production.list`.',
    implements: ['D-074', 'D-075'],
  })
  @ApiSuccess(200, {
    description: 'Board',
    type: ProductionBoardDto,
    example: {
      columns: [
        {
          key: 'awaiting_acceptance',
          labelTh: 'รอโรงงานรับงาน',
          labelEn: 'Awaiting acceptance',
          total: 2,
          atRisk: 0,
        },
        { key: 'printing', labelTh: 'กำลังพิมพ์', labelEn: 'Printing', total: 4, atRisk: 1 },
      ],
      total: 6,
      atRisk: 1,
    },
  })
  @ApiStandardErrors('validation.failed')
  board(@Query() q: ProductionBoardQuery): Promise<ProductionBoardDto> {
    return this.jobs.board(q);
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
      ...(q.factoryId && { factory: { publicId: q.factoryId } }),
      ...(q.productTypeCode && {
        order: { ...(q.orderId && { publicId: q.orderId }), productType: { code: q.productTypeCode } },
      }),
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
  @Idempotent({ optional: true })
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

  @Get('production-jobs/:jobId/qc-checks')
  @Can('production.read')
  @jobParam
  @ApiEndpoint({
    id: 'admin.production.listQc',
    summary: 'List the factory QC checks of a job',
    description: 'With photos (D-076).',
    implements: ['D-076'],
  })
  @ApiSuccess(200, { description: 'Checks', type: [QcCheckDto], example: [QC_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async listQc(@CurrentActor() actor: Actor, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return (await this.milestones.qcChecks(actor, jobId)).map(qcDto);
  }

  @Get('production-jobs/:jobId/issues')
  @Can('production.read')
  @jobParam
  @ApiEndpoint({
    id: 'admin.production.listIssues',
    summary: 'List the issues of a job',
    description: 'Raised by the factory.',
    implements: ['D-074'],
  })
  @ApiSuccess(200, { description: 'Issues', type: [JobIssueDto], example: [ISSUE_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async listIssues(@CurrentActor() actor: Actor, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return (await this.milestones.issues(actor, jobId)).map(issueDto);
  }

  @Post('job-issues/:issueId/actions/resolve')
  @HttpCode(200)
  @Can('production.manage')
  @ApiParam({ name: 'issueId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.production.resolveIssue',
    summary: 'Resolve a factory issue',
    description: 'With what was decided.',
    implements: ['D-074'],
  })
  @ApiBody({ type: ResolveIssueDto, examples: { default: { value: { note: 'เลื่อนวันส่งกับลูกค้าแล้ว' } } } })
  @ApiSuccess(200, {
    description: 'Resolved',
    type: JobIssueDto,
    example: {
      ...ISSUE_EXAMPLE,
      status: 'resolved',
      resolvedAt: '2026-10-02T12:00:00+07:00',
      resolutionNote: 'เลื่อนวันส่งกับลูกค้าแล้ว',
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'production.invalid_status',
  )
  async resolveIssue(
    @CurrentActor() actor: Actor,
    @Param('issueId', ParseUUIDPipe) issueId: string,
    @Body() body: ResolveIssueDto,
  ) {
    return issueDto(await this.milestones.resolveIssue(staff(actor), issueId, body.note));
  }

  @Post('production-jobs/:jobId/actions/hold')
  @HttpCode(200)
  @Can('production.manage')
  @jobParam
  @ApiEndpoint({
    id: 'admin.production.hold',
    summary: 'Put a job on hold',
    description: 'Milestones stop until it resumes; the reason is shown to the factory.',
    implements: ['D-074'],
  })
  @ApiBody({ type: HoldJobDto, examples: { default: { value: { reason: 'ลูกค้าขอพักงานเพื่อแก้ไฟล์' } } } })
  @ApiSuccess(200, {
    description: 'On hold',
    type: AdminJobDto,
    example: { ...ADMIN_JOB_EXAMPLE, status: 'on_hold', holdReason: 'ลูกค้าขอพักงานเพื่อแก้ไฟล์' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'production.invalid_status',
  )
  async hold(
    @CurrentActor() actor: Actor,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() body: HoldJobDto,
  ) {
    await this.milestones.hold(staff(actor), jobId, body.reason);
    return (await this.dtos(actor, [await this.jobs.get(actor, jobId)]))[0]!;
  }

  @Post('production-jobs/:jobId/actions/resume')
  @HttpCode(200)
  @Can('production.manage')
  @jobParam
  @ApiEndpoint({
    id: 'admin.production.resume',
    summary: 'Resume a job on hold',
    description: 'Back to accepted or in progress.',
    implements: ['D-074'],
  })
  @ApiSuccess(200, {
    description: 'Resumed',
    type: AdminJobDto,
    example: { ...ADMIN_JOB_EXAMPLE, status: 'in_progress' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'production.invalid_status')
  async resume(@CurrentActor() actor: Actor, @Param('jobId', ParseUUIDPipe) jobId: string) {
    await this.milestones.resume(staff(actor), jobId);
    return (await this.dtos(actor, [await this.jobs.get(actor, jobId)]))[0]!;
  }
}

function routeDto(r: RouteRow): MilestoneRouteDto {
  return {
    id: r.publicId,
    productTypeCode: r.productType.code,
    printTypeId: r.printType?.publicId ?? null,
    variant: r.variant,
    name: r.name,
    versions: r.versions.map((v) => ({
      versionNo: v.versionNo,
      status: v.status,
      effectiveFrom: toBangkokIso(v.effectiveFrom),
      reason: v.reason,
      steps: v.steps.map((st) => ({
        seq: st.seq,
        key: st.key,
        nameTh: st.nameTh,
        nameEn: st.nameEn,
        customerVisible: st.customerVisible,
        customerLabelTh: st.customerLabelTh,
        evidence: st.evidence,
        tracksQuantity: st.tracksQuantity,
        plannedSharePct: st.plannedSharePct?.toFixed(4) ?? null,
      })),
    })),
  };
}

@ApiSurface('admin', 'milestoneRoutes')
@Controller('milestone-routes')
export class AdminMilestoneRoutesController {
  constructor(private readonly routes: MilestoneRoutesService) {}

  @Get()
  @Can('production.read')
  @ApiEndpoint({
    id: 'admin.milestoneRoutes.list',
    summary: 'List milestone routes',
    description: 'Per product type and variant, with every version (D-075).',
    implements: ['D-075'],
  })
  @ApiSuccess(200, { description: 'Routes', type: [MilestoneRouteDto], example: [ROUTE_EXAMPLE] })
  @ApiStandardErrors()
  async list() {
    return (await this.routes.list()).map(routeDto);
  }

  @Post()
  @Can('milestone_routes.manage')
  @ApiEndpoint({
    id: 'admin.milestoneRoutes.create',
    summary: 'Create a milestone route',
    description:
      'For a product type (optionally a print type) and a variant; add its first version next (D-075).',
    implements: ['D-075'],
  })
  @ApiBody({
    type: CreateMilestoneRouteDto,
    examples: {
      default: {
        value: { productTypeCode: 'folding_carton', variant: 'digital', name: 'กล่องพิมพ์ดิจิทัล' },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Route',
    type: MilestoneRouteDto,
    example: { ...ROUTE_EXAMPLE, variant: 'digital', versions: [] },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'http.conflict',
  )
  async create(@CurrentActor() actor: Actor, @Body() body: CreateMilestoneRouteDto) {
    return routeDto(await this.routes.create(staff(actor), body));
  }

  @Post(':routeId/versions')
  @Can('milestone_routes.manage')
  @ApiParam({ name: 'routeId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.milestoneRoutes.addVersion',
    summary: 'Publish a new version of a route',
    description:
      'Effective from a date (never back-dated); jobs already released keep their version (D-075, ADR-0005). Audited.',
    implements: ['D-075', 'ADR-0005'],
  })
  @ApiBody({ type: AddRouteVersionDto, examples: { default: { value: ADD_ROUTE_VERSION_EXAMPLE } } })
  @ApiSuccess(201, { description: 'Route', type: MilestoneRouteDto, example: ROUTE_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'settings.backdated',
  )
  async addVersion(
    @CurrentActor() actor: Actor,
    @Param('routeId', ParseUUIDPipe) routeId: string,
    @Body() body: AddRouteVersionDto,
  ) {
    return routeDto(
      await this.routes.addVersion(staff(actor), routeId, {
        ...body,
        effectiveFrom: new Date(body.effectiveFrom),
      }),
    );
  }
}
