import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import {
  SubledgerReconciliationDto,
  SubledgerReconciliationQuery,
} from '@modules/financial-reports/financial-reports.dto';
import { dayOf } from '@common/ledger-core/dates';
import { ReasonDto } from '@modules/receivables/receivables.dto';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import {
  AssignTaskDto,
  CHECKLIST_EXAMPLE,
  CloseChecklistDto,
  EvidenceInputDto,
  NoteDto,
  TASK_KEYS,
} from './close.dto';
import { type ChecklistRow, type CheckResult, CLOSE_TASKS, CloseService } from './close.service';

const DOCS = ['D-033', 'D-169'];
const WRITE = ['http.bad_request', 'http.malformed_json', 'http.not_found', 'validation.failed'] as const;
const periodParam = ApiParam({ name: 'period', example: '2026-10', description: 'YYYY-MM' });
const taskParam = ApiParam({ name: 'taskKey', enum: TASK_KEYS, enumName: 'CloseTaskKey' });
const person = (u: { publicId: string; displayName: string } | null) =>
  u ? { id: u.publicId, name: u.displayName } : null;
const iso = (d: Date | null) => (d ? toBangkokIso(d) : null);

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

function taskKey(key: string): string {
  if (!(TASK_KEYS as readonly string[]).includes(key)) throw new DomainException('http.not_found');
  return key;
}

@ApiSurface('admin', 'close')
@Controller('close-checklists')
export class AdminCloseController {
  constructor(private readonly close: CloseService) {}

  private async dto(row: ChecklistRow): Promise<CloseChecklistDto> {
    const evidence = await this.close.evidence(row.id);
    return {
      id: row.publicId,
      period: dayOf(row.fiscalPeriod.startDate).slice(0, 7),
      periodStatus: row.fiscalPeriod.status,
      status: row.status,
      submittedBy: person(row.submittedBy),
      submittedAt: iso(row.submittedAt),
      closedBy: person(row.closedBy),
      closedAt: iso(row.closedAt),
      auditorSignedOffAt: iso(row.auditorSignedOffAt),
      lockedAt: iso(row.lockedAt),
      tasks: row.tasks.map((t) => ({
        id: t.publicId,
        stepNo: t.stepNo,
        key: t.key,
        automatic: CLOSE_TASKS.find((c) => c.key === t.key)?.auto ?? false,
        status: t.status,
        owner: person(t.owner),
        checkResult: (t.checkResult as unknown as CheckResult | null) ?? null,
        checkedAt: iso(t.checkedAt),
        note: t.note,
        waivedReason: t.waivedReason,
        completedBy: person(t.completedBy),
        completedAt: iso(t.completedAt),
        evidence: evidence.get(t.id) ?? [],
      })),
    };
  }

  @Get(':period')
  @Can('close.read')
  @periodParam
  @ApiEndpoint({
    id: 'admin.close.get',
    summary: 'Get a close checklist',
    description: 'The nine steps of the month with their checks, owners, evidence and status (§7).',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Checklist', type: CloseChecklistDto, example: CHECKLIST_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('period') period: string): Promise<CloseChecklistDto> {
    return this.dto(await this.close.get(period));
  }

  @Post(':period')
  @Can('close.manage')
  @Idempotent()
  @periodParam
  @ApiEndpoint({
    id: 'admin.close.open',
    summary: 'Open the close checklist of a month',
    description: 'Creates the nine §7 tasks (idempotent). Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiSuccess(201, { description: 'Checklist', type: CloseChecklistDto, example: CHECKLIST_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'validation.failed')
  async open(@CurrentActor() actor: Actor, @Param('period') period: string): Promise<CloseChecklistDto> {
    return this.dto(await this.close.open(staff(actor), period));
  }

  @Post(':period/tasks/:taskKey/actions/check')
  @HttpCode(200)
  @Can('close.manage')
  @Idempotent()
  @periodParam
  @taskParam
  @ApiEndpoint({
    id: 'admin.close.check',
    summary: 'Run a task’s check',
    description:
      'Runs the blocking check (unmatched cash, pending slips, POD without GR, pending journals, tax papers, sub-ledger differences) and keeps its result; a failing automatic check blocks the task. Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiSuccess(200, { description: 'Checklist', type: CloseChecklistDto, example: CHECKLIST_EXAMPLE })
  @ApiStandardErrors('http.bad_request', 'http.not_found', 'validation.failed', 'close.checklist_not_open')
  async check(
    @CurrentActor() actor: Actor,
    @Param('period') period: string,
    @Param('taskKey') key: string,
  ): Promise<CloseChecklistDto> {
    return this.dto(await this.close.check(staff(actor), period, taskKey(key)));
  }

  @Post(':period/tasks/:taskKey/actions/complete')
  @HttpCode(200)
  @Can('close.manage')
  @Idempotent()
  @periodParam
  @taskParam
  @ApiEndpoint({
    id: 'admin.close.complete',
    summary: 'Complete a task',
    description:
      'Done when its check (re-run now) passes, with a note; attach evidence separately. Step 9 is completed by the approval. Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({ type: NoteDto, examples: { default: { value: { note: 'กระทบยอดธนาคารแล้ว แนบไฟล์' } } } })
  @ApiSuccess(200, { description: 'Checklist', type: CloseChecklistDto, example: CHECKLIST_EXAMPLE })
  @ApiStandardErrors(
    ...WRITE,
    'close.checklist_not_open',
    'close.check_failed',
    'close.task_done',
    'close.review_by_approval',
  )
  async complete(
    @CurrentActor() actor: Actor,
    @Param('period') period: string,
    @Param('taskKey') key: string,
    @Body() body: NoteDto,
  ): Promise<CloseChecklistDto> {
    return this.dto(await this.close.complete(staff(actor), period, taskKey(key), body.note ?? null));
  }

  @Post(':period/tasks/:taskKey/actions/waive')
  @HttpCode(200)
  @Can('close.approve')
  @Idempotent()
  @periodParam
  @taskParam
  @ApiEndpoint({
    id: 'admin.close.waive',
    summary: 'Waive a task',
    description:
      'A Finance Manager accepts an explained exception, with the reason (§7). Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({
    type: ReasonDto,
    examples: { default: { value: { reason: 'รายการโอนระหว่างบัญชีรอตรวจ ยอดไม่มีสาระสำคัญ' } } },
  })
  @ApiSuccess(200, { description: 'Checklist', type: CloseChecklistDto, example: CHECKLIST_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'close.checklist_not_open', 'close.task_done', 'close.review_by_approval')
  async waive(
    @CurrentActor() actor: Actor,
    @Param('period') period: string,
    @Param('taskKey') key: string,
    @Body() body: ReasonDto,
  ): Promise<CloseChecklistDto> {
    return this.dto(await this.close.waive(staff(actor), period, taskKey(key), body.reason));
  }

  @Post(':period/tasks/:taskKey/actions/assign')
  @HttpCode(200)
  @Can('close.manage')
  @Idempotent()
  @periodParam
  @taskParam
  @ApiEndpoint({
    id: 'admin.close.assign',
    summary: 'Assign a task owner',
    description: 'The staff member responsible for the step (§7). Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({
    type: AssignTaskDto,
    examples: { default: { value: { ownerUserId: '0192f3a0-7c1e-7d2a-9b1f-000000000101' } } },
  })
  @ApiSuccess(200, { description: 'Checklist', type: CloseChecklistDto, example: CHECKLIST_EXAMPLE })
  @ApiStandardErrors(...WRITE)
  async assign(
    @CurrentActor() actor: Actor,
    @Param('period') period: string,
    @Param('taskKey') key: string,
    @Body() body: AssignTaskDto,
  ): Promise<CloseChecklistDto> {
    return this.dto(await this.close.assign(staff(actor), period, taskKey(key), body.ownerUserId));
  }

  @Post(':period/tasks/:taskKey/evidence')
  @Can('close.manage')
  @Idempotent()
  @periodParam
  @taskParam
  @ApiEndpoint({
    id: 'admin.close.addEvidence',
    summary: 'Attach evidence to a task',
    description:
      'An uploaded file kept as a financial record (§7 “owner & evidence”). Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({
    type: EvidenceInputDto,
    examples: {
      default: {
        value: { fileId: '0192f3a0-7c1e-7d2a-9b1f-000000560003', description: 'Bank reconciliation October' },
      },
    },
  })
  @ApiSuccess(201, { description: 'Checklist', type: CloseChecklistDto, example: CHECKLIST_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'file.not_ready')
  async evidence(
    @CurrentActor() actor: Actor,
    @Param('period') period: string,
    @Param('taskKey') key: string,
    @Body() body: EvidenceInputDto,
  ): Promise<CloseChecklistDto> {
    return this.dto(
      await this.close.addEvidence(staff(actor), period, taskKey(key), body.fileId, body.description),
    );
  }

  @Post(':period/actions/submit')
  @HttpCode(200)
  @Can('close.manage')
  @Idempotent()
  @periodParam
  @ApiEndpoint({
    id: 'admin.close.submit',
    summary: 'Submit the checklist for review',
    description:
      'Steps 1–8 done or waived; the month is soft-closed (§7 step 9). Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Checklist',
    type: CloseChecklistDto,
    example: { ...CHECKLIST_EXAMPLE, status: 'in_review', periodStatus: 'soft_closed' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.not_found',
    'validation.failed',
    'close.checklist_not_open',
    'close.tasks_open',
    'ledger.period_transition',
  )
  async submit(@CurrentActor() actor: Actor, @Param('period') period: string): Promise<CloseChecklistDto> {
    return this.dto(await this.close.submit(staff(actor), period));
  }

  @Post(':period/actions/approve')
  @HttpCode(200)
  @Can('close.approve')
  @Idempotent()
  @periodParam
  @ApiEndpoint({
    id: 'admin.close.approve',
    summary: 'Approve and close the month',
    description:
      'A Finance Manager other than the submitter reviews (step 9) and closes the period: postings go to the next open month (§1.4). Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({ type: NoteDto, examples: { default: { value: { note: 'ตรวจทานแล้ว' } } } })
  @ApiSuccess(200, {
    description: 'Checklist',
    type: CloseChecklistDto,
    example: { ...CHECKLIST_EXAMPLE, status: 'closed', periodStatus: 'closed' },
  })
  @ApiStandardErrors(
    ...WRITE,
    'close.checklist_not_in_review',
    'iam.sod_conflict',
    'ledger.period_transition',
  )
  async approve(
    @CurrentActor() actor: Actor,
    @Param('period') period: string,
    @Body() body: NoteDto,
  ): Promise<CloseChecklistDto> {
    return this.dto(await this.close.approve(staff(actor), period, body.note ?? null));
  }

  @Post(':period/actions/return')
  @HttpCode(200)
  @Can('close.approve')
  @Idempotent()
  @periodParam
  @ApiEndpoint({
    id: 'admin.close.return',
    summary: 'Return the checklist for work',
    description: 'The reviewer sends it back with a reason; the month reopens. Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiBody({ type: ReasonDto, examples: { default: { value: { reason: 'ขาดหลักฐานกระทบยอด' } } } })
  @ApiSuccess(200, { description: 'Checklist', type: CloseChecklistDto, example: CHECKLIST_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'close.checklist_not_in_review')
  async returnForWork(
    @CurrentActor() actor: Actor,
    @Param('period') period: string,
    @Body() body: ReasonDto,
  ): Promise<CloseChecklistDto> {
    return this.dto(await this.close.returnForWork(staff(actor), period, body.reason));
  }

  @Post(':period/actions/sign-off')
  @HttpCode(200)
  @Can('close.audit_sign_off')
  @Idempotent()
  @periodParam
  @ApiEndpoint({
    id: 'admin.close.signOff',
    summary: 'Auditor sign-off',
    description:
      'The auditor’s sign-off of a closed month, required to lock the last month of a fiscal year (§7 step 9). Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Checklist',
    type: CloseChecklistDto,
    example: { ...CHECKLIST_EXAMPLE, status: 'closed', auditorSignedOffAt: '2027-02-15T10:00:00+07:00' },
  })
  @ApiStandardErrors('http.bad_request', 'http.not_found', 'validation.failed', 'close.checklist_not_closed')
  async signOff(@CurrentActor() actor: Actor, @Param('period') period: string): Promise<CloseChecklistDto> {
    return this.dto(await this.close.signOff(staff(actor), period));
  }

  @Post(':period/actions/lock')
  @HttpCode(200)
  @Can('close.approve')
  @Idempotent()
  @periodParam
  @ApiEndpoint({
    id: 'admin.close.lock',
    summary: 'Lock the month',
    description:
      'Final: nothing posts into a locked period; year-end needs the auditor’s sign-off (§7 step 9). Requires `Idempotency-Key`.',
    implements: DOCS,
  })
  @ApiSuccess(200, {
    description: 'Checklist',
    type: CloseChecklistDto,
    example: { ...CHECKLIST_EXAMPLE, status: 'locked', periodStatus: 'locked' },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.not_found',
    'validation.failed',
    'close.checklist_incomplete',
    'close.auditor_sign_off_required',
    'ledger.period_transition',
  )
  async lock(@CurrentActor() actor: Actor, @Param('period') period: string): Promise<CloseChecklistDto> {
    return this.dto(await this.close.lock(staff(actor), period));
  }
}

@ApiSurface('admin', 'financialReports')
@Controller('financial-reports')
export class AdminSubledgerReconciliationController {
  constructor(private readonly close: CloseService) {}

  @Get('subledger-reconciliation')
  @Can('ledger.read')
  @ApiEndpoint({
    id: 'admin.financialReports.subledgerReconciliation',
    summary: 'Sub-ledgers against the general ledger',
    description:
      'The §7 step 8 rows (receivables, factory and vendor payables, advances, retention, store credit, fixed assets): ' +
      'sub-ledger, GL and difference, computed now — the sub-ledgers hold what is open now, so the rows are as of the ' +
      'computation; `period` only places the fixed-asset rows (D-033, D-169).',
    implements: ['D-033', 'D-169'],
  })
  @ApiSuccess(200, {
    description: 'Reconciliation',
    type: SubledgerReconciliationDto,
    example: {
      asOf: '2026-10-31T18:00:00+07:00',
      period: '2026-10',
      rows: [
        { key: 'receivables', accounts: '1210', subledger: '42800.00', gl: '42800.00', difference: '0.00' },
      ],
    },
  })
  @ApiStandardErrors('validation.failed', 'http.not_found')
  async reconciliation(@Query() q: SubledgerReconciliationQuery): Promise<SubledgerReconciliationDto> {
    const now = new Date();
    const period = q.period ?? bangkokDate(now).slice(0, 7);
    return { asOf: toBangkokIso(now), period, rows: await this.close.reconciliation(period) };
  }
}
