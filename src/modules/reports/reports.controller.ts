import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { DocumentFilesService } from '@modules/receivables/document-files.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { DownloadUrlDto } from '@platform/files/files.dto';

import { formatTimeOfDay, parseTimeOfDay } from './report-schedule';
import {
  GROUP_OF,
  isTotalled,
  type ReportColumn,
  type ReportDefinition,
  type ResolvedFilters,
} from './report-types';
import {
  CreateReportExportDto,
  CreateReportScheduleDto,
  EXAMPLES,
  ReportDefinitionDto,
  ReportFilterQuery,
  ReportPreviewDto,
  ReportRunDto,
  ReportRunQuery,
  ReportScheduleDto,
} from './reports.dto';
import { ReportsService, type RunRow, type ScheduleRow } from './reports.service';

const DOCS = ['D-111', 'D-033'];

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

const columnDto = (c: ReportColumn) => ({
  key: c.key,
  labelTh: c.labelTh,
  labelEn: c.labelEn,
  type: c.type,
  total: isTotalled(c),
});

const definitionDto = (d: ReportDefinition): ReportDefinitionDto => ({
  key: d.key,
  group: GROUP_OF[d.key] ?? 'operations',
  nameTh: d.nameTh,
  nameEn: d.nameEn,
  description: d.description,
  decisions: [...d.decisions],
  filters: d.filters.map((f) => ({
    key: f.key,
    kind: f.kind,
    required: f.required,
    values: f.values ? [...f.values] : null,
  })),
  columns: d.columns.map(columnDto),
  formats: ['xlsx', 'csv'],
});

export const runDto = (r: RunRow): ReportRunDto => ({
  id: r.publicId,
  reportKey: r.reportKey,
  format: r.format,
  status: r.status,
  filters: r.filters as ResolvedFilters,
  rowCount: r.rowCount,
  error: r.error,
  scheduleId: r.schedule?.publicId ?? null,
  queuedAt: toBangkokIso(r.queuedAt),
  finishedAt: r.finishedAt ? toBangkokIso(r.finishedAt) : null,
});

const scheduleDto = (s: ScheduleRow): ReportScheduleDto => ({
  id: s.publicId,
  reportKey: s.reportKey,
  name: s.name,
  format: s.format,
  frequency: s.frequency,
  runAt: formatTimeOfDay(s.runAtMinute),
  dayOfWeek: s.dayOfWeek,
  dayOfMonth: s.dayOfMonth,
  filters: s.filters as ReportScheduleDto['filters'],
  recipients: s.recipients.map((u) => ({ id: u.publicId, displayName: u.displayName })),
  active: s.active,
  nextRunAt: s.nextRunAt ? toBangkokIso(s.nextRunAt) : null,
  lastRunAt: s.lastRunAt ? toBangkokIso(s.lastRunAt) : null,
  createdAt: toBangkokIso(s.createdAt),
});

/** Drops the query keys that were not sent (the DTO carries every filter a report might use). */
const sent = (q: object): Record<string, unknown> =>
  Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== ''));

const RUN_EXAMPLE: ReportRunDto = {
  id: EXAMPLES.ids.run,
  reportKey: 'sales',
  format: 'xlsx',
  status: 'succeeded',
  filters: { from: '2026-10-01', to: '2026-10-31' },
  rowCount: 128,
  error: null,
  scheduleId: null,
  queuedAt: '2026-11-01T07:00:00+07:00',
  finishedAt: '2026-11-01T07:00:12+07:00',
};
const SCHEDULE_EXAMPLE: ReportScheduleDto = {
  id: EXAMPLES.ids.schedule,
  reportKey: 'ar_aging',
  name: 'AR aging — every Monday',
  format: 'xlsx',
  frequency: 'weekly',
  runAt: '07:00',
  dayOfWeek: 1,
  dayOfMonth: null,
  filters: { period: 'previous_day' },
  recipients: [{ id: EXAMPLES.ids.user, displayName: 'การเงิน ทดสอบ' }],
  active: true,
  nextRunAt: '2026-11-02T07:00:00+07:00',
  lastRunAt: null,
  createdAt: '2026-10-28T15:00:00+07:00',
};
const reportKeyParam = ApiParam({
  name: 'reportKey',
  example: 'sales',
  description: 'A key from `GET /v1/admin/reports`',
});

@ApiSurface('admin', 'reports')
@Controller('reports')
export class AdminReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @ApiEndpoint({
    id: 'admin.reports.catalogue',
    summary: 'List the reports I may run',
    description:
      'Operational reports (B6.2) whose data the caller may read: columns, filters and formats. Sales, sales tax, payments per channel (fees, VAT, WHT, net, settlement date), orders, quotations, campaign usage, points liability, AR / AP aging, payout history, factory scorecards, claims. Calculate / search / drawing / event-log reports are R2 (D-111).',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Reports',
    type: [ReportDefinitionDto],
    example: [
      {
        key: 'sales',
        group: 'sales',
        nameTh: 'รายงานยอดขาย',
        nameEn: 'Sales register',
        description: 'Every order of the order groups placed in the period…',
        decisions: ['D-010', 'D-020'],
        filters: [{ key: 'period', kind: 'range', required: true, values: null }],
        columns: [{ key: 'gross', labelTh: 'รวมทั้งสิ้น', labelEn: 'Gross', type: 'money', total: true }],
        formats: ['xlsx', 'csv'],
      },
    ],
  })
  @ApiStandardErrors()
  async catalogue(@CurrentActor() actor: Actor): Promise<ReportDefinitionDto[]> {
    return (await this.reports.catalogue(staff(actor))).map(definitionDto);
  }

  @Get(':reportKey/preview')
  @reportKeyParam
  @ApiEndpoint({
    id: 'admin.reports.preview',
    summary: 'Preview a report',
    description:
      'The first 200 rows with the given filters (explicit dates or a relative `period`, Asia/Bangkok); `truncated` when there are more — export the file for all of them. Requires the report’s data permission.',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Preview',
    type: ReportPreviewDto,
    example: {
      reportKey: 'sales',
      filters: { from: '2026-10-01', to: '2026-10-31' },
      columns: [{ key: 'gross', labelTh: 'รวมทั้งสิ้น', labelEn: 'Gross', type: 'money', total: true }],
      rows: [{ orderCode: 'ORD-2610-00012', gross: '10700.00', quantity: 1000 }],
      truncated: false,
      totals: { gross: '10700.00', quantity: 1000 },
      generatedAt: '2026-11-01T09:00:00+07:00',
    },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async preview(
    @CurrentActor() actor: Actor,
    @Param('reportKey') reportKey: string,
    @Query() q: ReportFilterQuery,
  ): Promise<ReportPreviewDto> {
    const { def, filters, rows, truncated, totals, generatedAt } = await this.reports.preview(
      staff(actor),
      reportKey,
      sent(q),
    );
    return {
      reportKey: def.key,
      filters,
      columns: def.columns.map(columnDto),
      rows,
      truncated,
      totals: totals as Record<string, string | number>,
      generatedAt: toBangkokIso(generatedAt),
    };
  }

  @Post(':reportKey/exports')
  @Can('reports.export')
  @HttpCode(202)
  @reportKeyParam
  @ApiEndpoint({
    id: 'admin.reports.export',
    summary: 'Export a report as XLSX or CSV',
    description:
      'Queues the file: the worker streams the rows into the workbook (or a UTF-8 CSV) and stores it; poll `GET /v1/admin/report-runs/{runId}` and download through `…/file` (a 5-minute signed URL, audited). Requires the report’s data permission and `reports.export`.',
    implements: DOCS,
  })
  @ApiBody({
    type: CreateReportExportDto,
    examples: { default: { value: { format: 'xlsx', filters: { from: '2026-10-01', to: '2026-10-31' } } } },
  })
  @ApiSuccess(202, {
    description: 'Queued',
    type: ReportRunDto,
    example: { ...RUN_EXAMPLE, status: 'queued', rowCount: null, finishedAt: null },
  })
  @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed')
  async export(
    @CurrentActor() actor: Actor,
    @Param('reportKey') reportKey: string,
    @Body() body: CreateReportExportDto,
  ): Promise<ReportRunDto> {
    return runDto(await this.reports.requestExport(staff(actor), reportKey, body.format, sent(body.filters)));
  }
}

@ApiSurface('admin', 'reports')
@Controller('report-runs')
export class AdminReportRunsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly files: DocumentFilesService,
  ) {}

  @Get()
  @ApiEndpoint({
    id: 'admin.reports.listRuns',
    summary: 'List report files',
    description:
      'Newest first (100): the runs of reports the caller may read that they requested or were sent (all of them with `reports.schedule`).',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Runs', type: [ReportRunDto], example: [RUN_EXAMPLE] })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: ReportRunQuery): Promise<ReportRunDto[]> {
    return (await this.reports.runs(staff(actor), q)).map(runDto);
  }

  @Get(':runId')
  @ApiParam({ name: 'runId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.reports.getRun',
    summary: 'Get a report file',
    description: '`queued` / `running` until the worker has written it.',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Run', type: ReportRunDto, example: RUN_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('runId', ParseUUIDPipe) runId: string,
  ): Promise<ReportRunDto> {
    return runDto(await this.reports.run(staff(actor), runId));
  }

  @Get(':runId/file')
  @Can('reports.export')
  @ApiParam({ name: 'runId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.reports.runFile',
    summary: 'Download a report file',
    description: 'A 5-minute signed URL; each download is an audited export (`report.downloaded`).',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Signed URL',
    type: DownloadUrlDto,
    example: {
      url: 'https://packio-files.s3.example.com/…&X-Amz-Expires=300',
      expiresAt: '2026-11-01T07:05:12+07:00',
    },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'file.not_ready')
  async file(
    @CurrentActor() actor: Actor,
    @Param('runId', ParseUUIDPipe) runId: string,
  ): Promise<DownloadUrlDto> {
    const d = await this.files.downloadUrl(await this.reports.file(staff(actor), runId));
    return { url: d.url, expiresAt: toBangkokIso(d.expiresAt) };
  }
}

const scheduleParam = ApiParam({ name: 'scheduleId', format: 'uuid' });

@ApiSurface('admin', 'reports')
@Controller('report-schedules')
export class AdminReportSchedulesController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @ApiEndpoint({
    id: 'admin.reports.listSchedules',
    summary: 'List report schedules',
    description: 'Schedules of the reports the caller may read, newest first.',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Schedules', type: [ReportScheduleDto], example: [SCHEDULE_EXAMPLE] })
  @ApiStandardErrors()
  async list(@CurrentActor() actor: Actor): Promise<ReportScheduleDto[]> {
    return (await this.reports.schedules(staff(actor))).map(scheduleDto);
  }

  @Post()
  @Can('reports.schedule')
  @ApiEndpoint({
    id: 'admin.reports.createSchedule',
    summary: 'Schedule a report',
    description:
      'Daily, weekly or monthly at a time of day (Asia/Bangkok) with a relative `period` (previous day / week / month, month or year to date). Recipients must be active staff who may read and export the report; they are told through the notification matrix (in-app + e-mail) and download the file in Packio — the data is never attached. Schedules are not edited: deactivate and create a new one.',
    implements: DOCS,
  })
  @ApiBody({
    type: CreateReportScheduleDto,
    examples: {
      default: {
        value: {
          reportKey: 'ar_aging',
          name: 'AR aging — every Monday',
          format: 'xlsx',
          frequency: 'weekly',
          runAt: '07:00',
          dayOfWeek: 1,
          filters: { period: 'previous_day' },
          recipientIds: [EXAMPLES.ids.user],
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Created', type: ReportScheduleDto, example: SCHEDULE_EXAMPLE })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'reports.recipient_not_allowed',
  )
  async create(
    @CurrentActor() actor: Actor,
    @Body() body: CreateReportScheduleDto,
  ): Promise<ReportScheduleDto> {
    const runAtMinute = parseTimeOfDay(body.runAt)!;
    const shape =
      body.frequency === 'daily'
        ? body.dayOfWeek === undefined && body.dayOfMonth === undefined
        : body.frequency === 'weekly'
          ? body.dayOfWeek !== undefined && body.dayOfMonth === undefined
          : body.dayOfMonth !== undefined && body.dayOfWeek === undefined;
    if (!shape)
      throw new DomainException('validation.failed', {
        errors: [
          {
            path: 'frequency',
            code: 'shape',
            message: 'weekly needs dayOfWeek, monthly needs dayOfMonth, daily neither',
          },
        ],
      });
    return scheduleDto(
      await this.reports.createSchedule(staff(actor), {
        reportKey: body.reportKey,
        name: body.name,
        format: body.format,
        timing: {
          frequency: body.frequency,
          runAtMinute,
          dayOfWeek: body.dayOfWeek ?? null,
          dayOfMonth: body.dayOfMonth ?? null,
        },
        filters: sent(body.filters),
        recipientIds: body.recipientIds,
      }),
    );
  }

  @Get(':scheduleId')
  @scheduleParam
  @ApiEndpoint({
    id: 'admin.reports.getSchedule',
    summary: 'Get a report schedule',
    description: 'With its recipients and next run.',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Schedule', type: ReportScheduleDto, example: SCHEDULE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('scheduleId', ParseUUIDPipe) id: string,
  ): Promise<ReportScheduleDto> {
    return scheduleDto(await this.reports.schedule(staff(actor), id));
  }

  @Post(':scheduleId/actions/deactivate')
  @Can('reports.schedule')
  @HttpCode(200)
  @scheduleParam
  @ApiEndpoint({
    id: 'admin.reports.deactivateSchedule',
    summary: 'Deactivate a report schedule',
    description: 'No further runs; files already sent stay available.',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Deactivated',
    type: ReportScheduleDto,
    example: { ...SCHEDULE_EXAMPLE, active: false, nextRunAt: null },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'reports.schedule_state')
  async deactivate(
    @CurrentActor() actor: Actor,
    @Param('scheduleId', ParseUUIDPipe) id: string,
  ): Promise<ReportScheduleDto> {
    return scheduleDto(await this.reports.setActive(staff(actor), id, false));
  }

  @Post(':scheduleId/actions/activate')
  @Can('reports.schedule')
  @HttpCode(200)
  @scheduleParam
  @ApiEndpoint({
    id: 'admin.reports.activateSchedule',
    summary: 'Activate a report schedule',
    description: 'Runs again from its next time.',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Activated', type: ReportScheduleDto, example: SCHEDULE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'reports.schedule_state')
  async activate(
    @CurrentActor() actor: Actor,
    @Param('scheduleId', ParseUUIDPipe) id: string,
  ): Promise<ReportScheduleDto> {
    return scheduleDto(await this.reports.setActive(staff(actor), id, true));
  }

  @Post(':scheduleId/actions/run')
  @Can('reports.schedule')
  @HttpCode(202)
  @scheduleParam
  @ApiEndpoint({
    id: 'admin.reports.runSchedule',
    summary: 'Run a report schedule now',
    description:
      'Queues a run with the schedule’s filters resolved now; recipients are notified as usual. Poll `GET /v1/admin/report-runs/{runId}`.',
    implements: DOCS,
  })
  @ApiSuccess(202, {
    description: 'Queued',
    type: ReportRunDto,
    example: {
      ...RUN_EXAMPLE,
      status: 'queued',
      scheduleId: EXAMPLES.ids.schedule,
      rowCount: null,
      finishedAt: null,
    },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async run(
    @CurrentActor() actor: Actor,
    @Param('scheduleId', ParseUUIDPipe) id: string,
  ): Promise<ReportRunDto> {
    return runDto(await this.reports.runNow(staff(actor), id));
  }
}
