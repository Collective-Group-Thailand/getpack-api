import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { toBangkokIso } from '@common/time/bangkok';
import { type Prisma } from '@generated/prisma/client';
import { permissionsOf } from '@modules/iam/actor-permissions';
import { PermissionResolver } from '@modules/iam/permission-resolver.service';
import { FactoryAccess } from '@modules/partners/factories/factory-access';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import { type JobRow, partnerJobDto } from './job-views';
import { issueDto, qcDto } from './job-views';
import { JobsQueryService } from './jobs-query.service';
import { MilestonesService } from './milestones.service';
import {
  FactoryTodayDto,
  ISSUE_EXAMPLE,
  JOB_IDS,
  JobIssueDto,
  JobListQuery,
  JobLookupDto,
  JobLookupQuery,
  MILESTONE_EXAMPLE,
  MilestoneUpdateResultDto,
  PARTNER_JOB_EXAMPLE,
  PartnerJobDto,
  QC_EXAMPLE,
  QcCheckDto,
  RaiseIssueDto,
  RecordQcDto,
  RejectJobDto,
  ResolveIssueDto,
  UpdateMilestoneDto,
} from './production.dto';
import { ProductionService } from './production.service';

export const jobParam = ApiParam({ name: 'jobId', format: 'uuid' });

/** The factory's side of production (partner surface, factory-scoped — other factories' jobs are 404). */
@ApiSurface('partner', 'production')
@Controller()
export class PartnerProductionController {
  constructor(
    private readonly production: ProductionService,
    private readonly jobs: JobsQueryService,
    private readonly milestones: MilestonesService,
    private readonly permissions: PermissionResolver,
  ) {}

  private async dtos(actor: Actor, rows: JobRow[]) {
    const [photos, extras, perms] = await Promise.all([
      this.jobs.photos(rows),
      this.jobs.extras(rows),
      permissionsOf(this.permissions, actor),
    ]);
    return rows.map((r) => partnerJobDto(r, photos, extras, perms));
  }

  @Get('production-jobs')
  @Can('factory_jobs.read')
  @ApiEndpoint({
    id: 'partner.production.list',
    summary: 'List my factory’s jobs',
    description:
      'Newest first; `awaiting_acceptance` = released jobs to accept within 1 business day (D-074); `view` picks a ' +
      'shop-floor view; `factoryId` narrows to one of my factories. Each job carries its product type, risk, ' +
      'tolerance, approved proof, getpack inspection and pieces already shipped per destination. No selling prices (D-142).',
    implements: ['D-074', 'D-142'],
  })
  @ApiPaginated(PartnerJobDto, { example: PARTNER_JOB_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: JobListQuery) {
    const where: Prisma.ProductionJobWhereInput = {
      AND: [
        {
          ...(q.status && { status: q.status }),
          ...(q.queue === 'awaiting_acceptance' && { status: 'released' }),
          ...(q.queue === 'at_risk' && { atRiskSince: { not: null } }),
          ...(q.factoryId && { factory: { publicId: q.factoryId } }),
          ...(q.orderId && { order: { publicId: q.orderId } }),
        },
        q.view ? VIEWS[q.view] : {},
      ],
    };
    const [rows, total] = await this.jobs.list(actor, where, q.page, q.perPage);
    return { data: await this.dtos(actor, rows), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get('production-jobs/lookup')
  @Can('factory_jobs.read')
  @ApiEndpoint({
    id: 'partner.production.lookup',
    summary: 'Find my job from a scanned or typed code',
    description:
      'A job number, a job id, or the label code of one of its cartons — within my factories only (404 otherwise).',
    implements: ['D-044'],
  })
  @ApiSuccess(200, {
    description: 'Job',
    type: JobLookupDto,
    example: { jobId: JOB_IDS.job, jobNo: 'JOB-2609-00001' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async lookup(@CurrentActor() actor: Actor, @Query() q: JobLookupQuery): Promise<JobLookupDto> {
    const job = await this.jobs.lookup(actor, q.code);
    return { jobId: job.publicId, jobNo: job.jobNo };
  }

  @Get('production-jobs/:jobId')
  @Can('factory_jobs.read')
  @jobParam
  @ApiEndpoint({
    id: 'partner.production.get',
    summary: 'Get one of my jobs',
    description:
      'Spec, the approved artwork and dieline (download the approved version only), destinations by code, province ' +
      'and postcode prefix — never the recipient (P4-D1) — and milestones.',
    implements: ['D-142', 'D-075'],
  })
  @ApiSuccess(200, { description: 'Job', type: PartnerJobDto, example: PARTNER_JOB_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@CurrentActor() actor: Actor, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return (await this.dtos(actor, [await this.jobs.get(actor, jobId)]))[0]!;
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
    return (await this.dtos(actor, [await this.jobs.get(actor, jobId)]))[0]!;
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
      'getpack moves the job to another factory when one keeps the margin floor (D-012, D-101) or escalates it; ' +
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
    return (await this.dtos(actor, [await this.jobs.get(actor, jobId)]))[0]!;
  }

  @Post('production-jobs/:jobId/milestones/:milestoneId')
  @HttpCode(200)
  @Idempotent()
  @Can('factory_milestones.update')
  @jobParam
  @ApiParam({ name: 'milestoneId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.production.updateMilestone',
    summary: 'Start or complete a milestone',
    description:
      'In route order, with quantities in / out / scrap on steps that track them (out + scrap never exceed what ' +
      'came in) and the evidence the step needs — photos and / or the QC form (D-075, D-076). Idempotent: the ' +
      '`Idempotency-Key` and the device’s `clientRef` make replays harmless; on a conflict the server wins and ' +
      'answers `applied: false` with the current job. Completing on time counts for the scorecard (D-155).',
    implements: ['D-075', 'D-076', 'D-155'],
  })
  @ApiBody({
    type: UpdateMilestoneDto,
    examples: {
      default: {
        value: {
          action: 'complete',
          quantityIn: 1050,
          quantityOut: 1020,
          quantityScrap: 30,
          photoFileIds: [JOB_IDS.file],
          clientRef: '0192f3a0-7c1e-7d2a-9b1f-0000000f1101',
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Outcome and the job',
    type: MilestoneUpdateResultDto,
    example: {
      applied: true,
      reason: null,
      job: {
        ...PARTNER_JOB_EXAMPLE,
        status: 'in_progress',
        milestones: [{ ...MILESTONE_EXAMPLE, status: 'completed' }],
      },
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'production.invalid_status',
    'production.milestone_out_of_order',
    'production.evidence_missing',
    'production.quantity_invalid',
    'artwork.file_not_usable',
  )
  async updateMilestone(
    @CurrentActor() actor: Actor,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @Body() body: UpdateMilestoneDto,
  ): Promise<MilestoneUpdateResultDto> {
    const outcome = await this.milestones.update(actor, jobId, milestoneId, {
      ...body,
      clientReportedAt: body.clientReportedAt ? new Date(body.clientReportedAt) : undefined,
    });
    return { ...outcome, job: (await this.dtos(actor, [await this.jobs.get(actor, jobId)]))[0]! };
  }

  @Post('production-jobs/:jobId/qc-checks')
  @Idempotent()
  @Can('factory_qc.record')
  @jobParam
  @ApiEndpoint({
    id: 'partner.production.recordQc',
    summary: 'Record a QC check with photos',
    description:
      'The factory’s QC checklist with photo evidence (D-076); the first check of a job decides “first pass” (D-155).',
    implements: ['D-076', 'D-155'],
  })
  @ApiBody({
    type: RecordQcDto,
    examples: {
      default: {
        value: {
          checklistVersion: 'folding-v1',
          checklist: { colour: 'ok' },
          result: 'pass',
          quantityChecked: 80,
          photoFileIds: [JOB_IDS.file],
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Recorded', type: QcCheckDto, example: QC_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'production.invalid_status',
    'production.evidence_missing',
    'artwork.file_not_usable',
  )
  async recordQc(
    @CurrentActor() actor: Actor,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() body: RecordQcDto,
  ): Promise<QcCheckDto> {
    const qc = await this.milestones.recordQc(actor, jobId, body);
    return qcDto({ ...qc, photoFileIds: body.photoFileIds });
  }

  @Get('production-jobs/:jobId/qc-checks')
  @Can('factory_jobs.read')
  @jobParam
  @ApiEndpoint({
    id: 'partner.production.listQc',
    summary: 'List the QC checks of my job',
    description: 'Oldest first, with photos (D-076).',
    implements: ['D-076'],
  })
  @ApiSuccess(200, { description: 'Checks', type: [QcCheckDto], example: [QC_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async listQc(@CurrentActor() actor: Actor, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return (await this.milestones.qcChecks(actor, jobId)).map(qcDto);
  }

  @Post('production-jobs/:jobId/issues')
  @Idempotent({ optional: true })
  @Can('factory_issues.raise')
  @jobParam
  @ApiEndpoint({
    id: 'partner.production.raiseIssue',
    summary: 'Raise an issue on my job',
    description:
      'Material shortage, machine down, a question about the artwork… (named kinds, D-232) with photos. getpack staff ' +
      'answer it; the factory may close an issue it raised itself (`partner.production.resolveIssue`).',
    implements: ['D-074', 'D-232'],
  })
  @ApiBody({
    type: RaiseIssueDto,
    examples: {
      default: { value: { kind: 'material_shortage', description: 'กระดาษอาร์ตการ์ดขาดสต็อก รอของ 2 วัน' } },
    },
  })
  @ApiSuccess(201, { description: 'Raised', type: JobIssueDto, example: ISSUE_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'artwork.file_not_usable',
  )
  async raiseIssue(
    @CurrentActor() actor: Actor,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() body: RaiseIssueDto,
  ) {
    return issueDto(await this.milestones.raiseIssue(actor, jobId, body));
  }

  @Get('production-jobs/:jobId/issues')
  @Can('factory_jobs.read')
  @jobParam
  @ApiEndpoint({
    id: 'partner.production.listIssues',
    summary: 'List the issues of my job',
    description: 'Open and resolved.',
    implements: ['D-074'],
  })
  @ApiSuccess(200, { description: 'Issues', type: [JobIssueDto], example: [ISSUE_EXAMPLE] })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async listIssues(@CurrentActor() actor: Actor, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return (await this.milestones.issues(actor, jobId)).map(issueDto);
  }

  @Post('production-jobs/:jobId/issues/:issueId/actions/resolve')
  @HttpCode(200)
  @Idempotent({ optional: true })
  @Can('factory_issues.raise')
  @jobParam
  @ApiParam({ name: 'issueId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.production.resolveIssue',
    summary: 'Close an issue my factory raised',
    description:
      'With a note (e.g. the machine is fixed). Only issues raised by the factory’s own people (403 for an issue ' +
      'getpack opened); never moves the job’s dates or SLA (D-232). Audited with an event.',
    implements: ['D-232'],
  })
  @ApiBody({
    type: ResolveIssueDto,
    examples: { default: { value: { note: 'ซ่อมเครื่องเสร็จแล้ว เดินงานต่อ' } } },
  })
  @ApiSuccess(200, {
    description: 'Closed',
    type: JobIssueDto,
    example: { ...ISSUE_EXAMPLE, status: 'resolved', resolutionNote: 'ซ่อมเครื่องเสร็จแล้ว เดินงานต่อ' },
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
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Param('issueId', ParseUUIDPipe) issueId: string,
    @Body() body: ResolveIssueDto,
  ): Promise<JobIssueDto> {
    return issueDto(await this.milestones.resolveOwnIssue(actor, jobId, issueId, body.note));
  }
}

const VIEWS: Record<NonNullable<JobListQuery['view']>, Prisma.ProductionJobWhereInput> = {
  to_accept: { status: 'released' },
  in_production: { status: { in: ['accepted', 'in_progress', 'on_hold'] } },
  ready_to_ship: {
    status: 'completed',
    order: { cancelledAt: null },
    // D-258: a sample's job is ready to ship too.
    OR: [
      { jobKind: 'production', order: { deliveredAt: null } },
      { jobKind: 'mockup', sample: { is: { status: { in: ['paid', 'in_production'] } } } },
    ],
  },
  late: { atRiskSince: { not: null }, status: { in: ['accepted', 'in_progress', 'on_hold'] } },
};

@ApiSurface('partner', 'production')
@Controller('factories/:factoryId')
export class PartnerShopFloorController {
  constructor(
    private readonly jobs: JobsQueryService,
    private readonly access: FactoryAccess,
    private readonly permissions: PermissionResolver,
  ) {}

  @Get('today')
  @Can('factory_jobs.read')
  @ApiParam({ name: 'factoryId', format: 'uuid' })
  @ApiEndpoint({
    id: 'partner.production.today',
    summary: 'My factory’s day',
    description:
      'Jobs to accept and how many are past the 1-business-day deadline (D-074), steps due today (Asia/Bangkok), ' +
      'jobs at risk or on hold, getpack inspections planned (D-076); alerts; and a work queue of at most 20 jobs — ' +
      'acceptance by deadline, then at-risk jobs, then steps due today.',
    implements: ['D-074', 'D-076', 'D-101'],
  })
  @ApiSuccess(200, {
    description: 'Today',
    type: FactoryTodayDto,
    example: {
      counters: {
        awaitingAcceptance: 1,
        acceptanceOverdue: 0,
        milestonesDueToday: 2,
        atRisk: 0,
        onHold: 0,
        inspectionsPlanned: 0,
      },
      alerts: [
        {
          kind: 'acceptance_due_soon',
          jobId: JOB_IDS.job,
          jobNo: 'JOB-2609-00001',
          dueAt: '2026-09-28T10:00:00+07:00',
        },
      ],
      queue: [PARTNER_JOB_EXAMPLE],
    },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async today(
    @CurrentActor() actor: Actor,
    @Param('factoryId', ParseUUIDPipe) factoryId: string,
  ): Promise<FactoryTodayDto> {
    const factory = await this.access.factory(actor, factoryId);
    const { counters, alerts, queue } = await this.jobs.today(factory.id);
    const [photos, extras, perms] = await Promise.all([
      this.jobs.photos(queue),
      this.jobs.extras(queue),
      permissionsOf(this.permissions, actor),
    ]);
    return {
      counters,
      alerts: alerts.map((a) => ({ ...a, dueAt: a.dueAt ? toBangkokIso(a.dueAt) : null })),
      queue: queue.map((r) => partnerJobDto(r, photos, extras, perms)),
    };
  }
}
