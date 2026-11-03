import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { IfMatch } from '@common/etag/etag.interceptor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import {
  ApiConcurrency,
  ApiEndpoint,
  ApiEtag,
  ApiStandardErrors,
  ApiSuccess,
} from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { PageQuery } from '@common/pagination/pagination.dto';
import { staffActor } from '@modules/sales-desk/sales-scope';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiParam, ApiPropertyOptional } from '@nestjs/swagger';
import { DownloadUrlDto } from '@platform/files/files.dto';
import { IsIn, IsOptional } from 'class-validator';
import { type Response } from 'express';

import {
  CopyPnlPlanDto,
  CreatePnlPlanDto,
  ExportPnlPlanDto,
  GRID_EXAMPLE,
  LINE_EXAMPLE,
  PLAN_EXAMPLE,
  PNL_SOURCE_KINDS,
  PnlGridDto,
  PnlLineCatalogueDto,
  PnlPlanDto,
  PnlPlanListQuery,
  PnlSourceItemDto,
  PnlVarianceDto,
  SetPnlVarianceNoteDto,
  SOURCE_EXAMPLE,
  UpdatePnlCellDto,
  UpdatePnlPlanDto,
  VARIANCE_EXAMPLE,
} from './pnl.dto';
import { planEtag, PnlPlansService } from './pnl-plans.service';
import { planDto, PnlViewsService } from './pnl-views.service';

const DECISIONS = ['D-472'];
const WRITE = ['http.bad_request', 'http.malformed_json', 'validation.failed'] as const;

class PnlSourceQuery extends PageQuery {
  @ApiPropertyOptional({
    enum: PNL_SOURCE_KINDS,
    enumName: 'PnlSourceKind',
    description:
      'Another view of the same cell where it has one: `commission` (commission records earned in the month) for the commission lines; default: the cell’s own source',
  })
  @IsOptional()
  @IsIn(PNL_SOURCE_KINDS)
  kind?: (typeof PNL_SOURCE_KINDS)[number];
}

const PLAN_PARAM = ApiParam({ name: 'planId', format: 'uuid' });
const LINE_PARAM = ApiParam({ name: 'lineKey', description: 'A `PnlLineKey`', example: 'salaries' });
const MONTH_PARAM = ApiParam({
  name: 'month',
  description: '`YYYY-MM` of the plan year',
  example: '2027-01',
});

/**
 * D-472 (PLAN A-14): the management P&L planner for Finance and executives. Read: C-Level, VP, Director, Finance
 * Manager (+ Superadmin); manage and export: C-Level and Finance Manager. Management figures only — never posted.
 */
@ApiSurface('admin', 'pnl')
@Controller('finance/pnl')
export class AdminPnlController {
  constructor(
    private readonly plans: PnlPlansService,
    private readonly views: PnlViewsService,
  ) {}

  @Get('lines')
  @Can('pnl.read')
  @ApiEndpoint({
    id: 'admin.pnl.listLines',
    summary: 'List the P&L lines with their tooltips',
    description:
      'Every line in display order with its group, unit, whether it is calculated or entered, and the tooltip fields ' +
      '`definition`, `formula`, `source`, `howToFill` (lines a person may enter) and `glAccounts` from the setting ' +
      '`pnl.line_catalogue` in force (D-472). A line without accounts is filled by hand.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Line catalogue',
    type: PnlLineCatalogueDto,
    example: { effectiveFrom: '2026-11-03T00:00:00+07:00', lines: [LINE_EXAMPLE] },
  })
  @ApiStandardErrors('validation.failed')
  lines(): Promise<PnlLineCatalogueDto> {
    return this.views.catalogue();
  }

  @Get('plans')
  @Can('pnl.read')
  @ApiEndpoint({
    id: 'admin.pnl.listPlans',
    summary: 'List P&L plans',
    description:
      'Plans by fiscal year, scenario and status, newest year first (deleted drafts excluded) (D-472).',
    implements: DECISIONS,
  })
  @ApiPaginated(PnlPlanDto, { example: PLAN_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: PnlPlanListQuery) {
    const [rows, total] = await this.plans.list(q);
    return { data: rows.map(planDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Post('plans')
  @Can('pnl.manage')
  @ApiEndpoint({
    id: 'admin.pnl.createPlan',
    summary: 'Create a P&L plan',
    description:
      'A draft for a calendar year and scenario, filled at once from the system: actual months from the posted ' +
      'ledger, forecast months from the pipeline, run rate, trailing ratios / averages and the fixed-asset register; ' +
      'lines without system data are left for manual entry. The same name, year and scenario takes the next version ' +
      '(D-472).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: CreatePnlPlanDto,
    examples: { default: { value: { name: 'แผนปี 2027', fiscalYear: 2027, scenario: 'base' } } },
  })
  @ApiSuccess(201, { description: 'Plan', type: PnlPlanDto, example: PLAN_EXAMPLE })
  @ApiStandardErrors(...WRITE)
  async create(@CurrentActor() actor: Actor, @Body() body: CreatePnlPlanDto): Promise<PnlPlanDto> {
    return planDto(await this.plans.create(staffActor(actor), body));
  }

  @Get('plans/:planId')
  @Can('pnl.read')
  @ApiEtag()
  @PLAN_PARAM
  @ApiEndpoint({
    id: 'admin.pnl.getPlan',
    summary: 'Get a P&L plan',
    description: 'The plan with its `ETag` (also in `etag`) for update, recompute, lock and delete (D-472).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Plan', type: PnlPlanDto, example: PLAN_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @Param('planId', ParseUUIDPipe) planId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PnlPlanDto> {
    const plan = await this.plans.get(planId);
    res.setHeader('ETag', planEtag(plan));
    return planDto(plan);
  }

  @Patch('plans/:planId')
  @Can('pnl.manage')
  @ApiConcurrency()
  @PLAN_PARAM
  @ApiEndpoint({
    id: 'admin.pnl.updatePlan',
    summary: 'Rename a draft plan or change its note',
    description: 'Drafts only (`pnl.plan_locked`); a new name takes its next free version (D-472).',
    implements: DECISIONS,
  })
  @ApiBody({ type: UpdatePnlPlanDto, examples: { default: { value: { note: 'ปรับตามยอดไตรมาส 1' } } } })
  @ApiSuccess(200, { description: 'Plan', type: PnlPlanDto, example: PLAN_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'http.not_found', 'pnl.plan_locked')
  async update(
    @CurrentActor() actor: Actor,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() body: UpdatePnlPlanDto,
    @IfMatch() ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PnlPlanDto> {
    const plan = await this.plans.update(staffActor(actor), planId, body, ifMatch);
    res.setHeader('ETag', planEtag(plan));
    return planDto(plan);
  }

  @Delete('plans/:planId')
  @HttpCode(204)
  @Can('pnl.manage')
  @ApiConcurrency()
  @PLAN_PARAM
  @ApiEndpoint({
    id: 'admin.pnl.deletePlan',
    summary: 'Delete a draft plan',
    description:
      'Soft delete of a draft (audited); a locked plan is never deleted (`pnl.plan_locked`) (D-472).',
    implements: DECISIONS,
  })
  @ApiSuccess(204, { description: 'Deleted' })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'pnl.plan_locked')
  async remove(
    @CurrentActor() actor: Actor,
    @Param('planId', ParseUUIDPipe) planId: string,
    @IfMatch() ifMatch: string | undefined,
  ): Promise<void> {
    await this.plans.remove(staffActor(actor), planId, ifMatch);
  }

  @Get('plans/:planId/grid')
  @Can('pnl.read')
  @PLAN_PARAM
  @ApiEndpoint({
    id: 'admin.pnl.getGrid',
    summary: 'Get the P&L grid of a plan',
    description:
      'Lines × months with each cell’s value, mode (auto · calculated · manual · override), auto value beside an ' +
      'override, source and its inputs, note / reason, who changed it, as-of time, `periodOpen` ("ยังไม่ปิดงวด") and ' +
      'its `etag`; the year column; the memo band (not in the total); the summary strip (net revenue, gross margin %, ' +
      'contribution after commission, EBITDA, net profit, cash conversion cycle, break-even revenue). Every view is ' +
      'written to the access log (D-472, D-444 pattern).',
    implements: [...DECISIONS, 'D-444'],
  })
  @ApiSuccess(200, { description: 'Grid', type: PnlGridDto, example: GRID_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async grid(
    @CurrentActor() actor: Actor,
    @Param('planId', ParseUUIDPipe) planId: string,
  ): Promise<PnlGridDto> {
    const me = staffActor(actor);
    const plan = await this.plans.get(planId);
    await this.views.logAccess(me, plan, 'view');
    return this.views.grid(plan);
  }

  @Put('plans/:planId/cells/:lineKey/:month')
  @Can('pnl.manage')
  @ApiConcurrency()
  @PLAN_PARAM
  @LINE_PARAM
  @MONTH_PARAM
  @ApiEndpoint({
    id: 'admin.pnl.updateCell',
    summary: 'Enter or override a cell',
    description:
      '`If-Match` = the cell’s `etag`. A line without system data takes a manual value (a note is required on the ' +
      'first entry, `pnl.note_required`); changing a value the system computed is an override that keeps the auto ' +
      'value beside it and needs a reason every time (`pnl.reason_required`); `value: null` (or the auto value) ' +
      'returns to auto. Formula and memo lines are read-only (`pnl.line_read_only`), locked plans too ' +
      '(`pnl.plan_locked`). The plan’s formulas are recomputed; audited with before / after (D-472).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: UpdatePnlCellDto,
    examples: {
      manual: { value: { value: '250000.00', note: 'พนักงาน 5 คน × 50,000' } },
      override: { value: { value: '120000.00', note: 'งานแสดงสินค้าเดือนนี้' } },
      revert: { value: { value: null } },
    },
  })
  @ApiSuccess(200, { description: 'The plan’s grid after the edit', type: PnlGridDto, example: GRID_EXAMPLE })
  @ApiStandardErrors(
    ...WRITE,
    'http.not_found',
    'pnl.plan_locked',
    'pnl.line_read_only',
    'pnl.note_required',
    'pnl.reason_required',
  )
  async updateCell(
    @CurrentActor() actor: Actor,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Param('lineKey') lineKey: string,
    @Param('month') month: string,
    @Body() body: UpdatePnlCellDto,
    @IfMatch() ifMatch: string | undefined,
  ): Promise<PnlGridDto> {
    const plan = await this.plans.updateCell(staffActor(actor), planId, lineKey, month, body, ifMatch);
    return this.views.grid(plan);
  }

  @Post('plans/:planId/actions/recompute')
  @HttpCode(200)
  @Can('pnl.manage')
  @ApiConcurrency()
  @PLAN_PARAM
  @ApiEndpoint({
    id: 'admin.pnl.recompute',
    summary: 'Refresh a draft plan from the system',
    description:
      'Recomputes every auto value from the ledger, pipeline, commissions and fixed assets as of now; manual and ' +
      'override values are kept (a manual value whose line gained system data becomes an override with its note as the ' +
      'reason) (D-472).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Grid', type: PnlGridDto, example: GRID_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'pnl.plan_locked')
  async recompute(
    @CurrentActor() actor: Actor,
    @Param('planId', ParseUUIDPipe) planId: string,
    @IfMatch() ifMatch: string | undefined,
  ): Promise<PnlGridDto> {
    return this.views.grid(await this.plans.recompute(staffActor(actor), planId, ifMatch));
  }

  @Post('plans/:planId/actions/copy')
  @Can('pnl.manage')
  @PLAN_PARAM
  @ApiEndpoint({
    id: 'admin.pnl.copyPlan',
    summary: 'Copy a plan to a scenario',
    description:
      'Any plan (draft or locked) becomes a new draft of the chosen scenario — the next version of that name — with ' +
      'its manual and override values and notes, then refreshed from the system (D-472).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: CopyPnlPlanDto,
    examples: { default: { value: { scenario: 'worst', note: 'กรณียอดขายลด 20 %' } } },
  })
  @ApiSuccess(201, {
    description: 'The new draft',
    type: PnlPlanDto,
    example: { ...PLAN_EXAMPLE, scenario: 'worst' },
  })
  @ApiStandardErrors(...WRITE, 'http.not_found')
  async copy(
    @CurrentActor() actor: Actor,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() body: CopyPnlPlanDto,
  ): Promise<PnlPlanDto> {
    return planDto(await this.plans.copy(staffActor(actor), planId, body));
  }

  @Post('plans/:planId/actions/lock')
  @HttpCode(200)
  @Can('pnl.manage')
  @Idempotent()
  @ApiConcurrency()
  @PLAN_PARAM
  @ApiEndpoint({
    id: 'admin.pnl.lockPlan',
    summary: 'Lock a plan for plan vs actual',
    description:
      'Final: the plan and its cells are frozen by the database (a revision is a copy) and the SHA-256 of its cells ' +
      'is kept. `If-Match` makes sure the plan locked is the one seen; never computed → `pnl.not_computed`. No ' +
      'maker-checker: a management plan is neither money-moving nor configuration (accounting-design §8) (D-472).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Locked plan',
    type: PnlPlanDto,
    example: {
      ...PLAN_EXAMPLE,
      status: 'locked',
      lockedAt: '2026-12-28T10:00:00+07:00',
      lockedBy: PLAN_EXAMPLE.owner,
      snapshotSha256: '9f2c0d1e7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d',
    },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'pnl.plan_locked', 'pnl.not_computed')
  async lock(
    @CurrentActor() actor: Actor,
    @Param('planId', ParseUUIDPipe) planId: string,
    @IfMatch() ifMatch: string | undefined,
  ): Promise<PnlPlanDto> {
    return planDto(await this.plans.lock(staffActor(actor), planId, ifMatch));
  }

  @Get('plans/:planId/variance')
  @Can('pnl.read')
  @PLAN_PARAM
  @ApiEndpoint({
    id: 'admin.pnl.getVariance',
    summary: 'Plan vs actual',
    description:
      'Per line and month: the plan value (frozen once locked), the actual as of now (posted ledger; formulas from ' +
      'actual lines, using the plan value of a line without an actual source — flagged `includes_plan_values`), ' +
      'variance amount and %, Finance’s note; totals over the actual months. Every view is logged (D-472).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Plan vs actual', type: PnlVarianceDto, example: VARIANCE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async variance(
    @CurrentActor() actor: Actor,
    @Param('planId', ParseUUIDPipe) planId: string,
  ): Promise<PnlVarianceDto> {
    const me = staffActor(actor);
    const plan = await this.plans.get(planId);
    await this.views.logAccess(me, plan, 'variance');
    return this.views.variance(plan);
  }

  @Put('plans/:planId/variance-notes/:lineKey/:month')
  @Can('pnl.manage')
  @PLAN_PARAM
  @LINE_PARAM
  @MONTH_PARAM
  @ApiEndpoint({
    id: 'admin.pnl.setVarianceNote',
    summary: 'Explain a variance',
    description:
      'Finance’s note on a line and month of plan vs actual; allowed on locked plans (cells stay frozen); audited (D-472).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: SetPnlVarianceNoteDto,
    examples: { default: { value: { note: 'ลูกค้ารายใหญ่สั่งเร็วกว่าแผน' } } },
  })
  @ApiSuccess(200, { description: 'Plan vs actual', type: PnlVarianceDto, example: VARIANCE_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'http.not_found')
  async setVarianceNote(
    @CurrentActor() actor: Actor,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Param('lineKey') lineKey: string,
    @Param('month') month: string,
    @Body() body: SetPnlVarianceNoteDto,
  ): Promise<PnlVarianceDto> {
    const me = staffActor(actor);
    const plan = await this.plans.get(planId);
    await this.views.setVarianceNote(me, plan, lineKey, month, body.note);
    return this.views.variance(plan);
  }

  @Get('plans/:planId/cells/:lineKey/:month/sources')
  @Can('pnl.read')
  @PLAN_PARAM
  @LINE_PARAM
  @MONTH_PARAM
  @ApiEndpoint({
    id: 'admin.pnl.listCellSources',
    summary: 'Drill down from a cell to its source records',
    description:
      'Paged ids and links only: posted journal lines of the mapped accounts (with source document and order) for ' +
      'actual months and trailing windows, open leads (weighted) behind forecast revenue and commission, fixed assets ' +
      'behind forecast depreciation, commission records (`kind=commission`) for the commission lines. Formula cells ' +
      'have none. No contact data (D-472).',
    implements: DECISIONS,
  })
  @ApiPaginated(PnlSourceItemDto, { example: SOURCE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async sources(
    @Param('planId', ParseUUIDPipe) planId: string,
    @Param('lineKey') lineKey: string,
    @Param('month') month: string,
    @Query() q: PnlSourceQuery,
  ) {
    const plan = await this.plans.get(planId);
    const { data, total } = await this.views.sources(plan, lineKey, month, q.page, q.perPage, q.kind);
    return { data, meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Post('plans/:planId/exports')
  @HttpCode(200)
  @Can('pnl.export')
  @PLAN_PARAM
  @ApiEndpoint({
    id: 'admin.pnl.exportPlan',
    summary: 'Export a plan as XLSX or PDF',
    description:
      'Finance Manager and C-Level only (`pnl.export`): the grid (or plan vs actual) with manual / override marks and ' +
      'notes, watermarked with the viewer’s name and the time on every page / sheet, behind a 5-minute link; logged ' +
      'in the access log and audited as an export (D-472).',
    implements: DECISIONS,
  })
  @ApiBody({ type: ExportPnlPlanDto, examples: { default: { value: { format: 'xlsx', view: 'plan' } } } })
  @ApiSuccess(200, {
    description: 'Download link',
    type: DownloadUrlDto,
    example: { url: 'https://getpack-files.s3.example.com/…', expiresAt: '2026-11-03T10:05:00+07:00' },
  })
  @ApiStandardErrors(...WRITE, 'http.not_found')
  async export(
    @CurrentActor() actor: Actor,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() body: ExportPnlPlanDto,
  ): Promise<DownloadUrlDto> {
    const plan = await this.plans.get(planId);
    return this.views.export(staffActor(actor), plan, body.format, body.view ?? 'plan');
  }
}
