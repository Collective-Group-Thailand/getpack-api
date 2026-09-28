import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { IfMatch } from '@common/etag/etag.interceptor';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { formatMoney } from '@common/money/money';
import {
  ApiConcurrency,
  ApiEndpoint,
  ApiEtag,
  ApiStandardErrors,
  ApiSuccess,
} from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { EntitiesService } from '@platform/entities/entities.service';
import { type Response } from 'express';

import { JournalsQueryService } from './journals-query.service';
import {
  ACCOUNT_CHANGE_EXAMPLE,
  ACCOUNT_EXAMPLE,
  AccountChangeDto,
  AccountChangeListQuery,
  AccountDto,
  COST_CENTRE_EXAMPLE,
  CostCentreDto,
  CreateCostCentreDto,
  FISCAL_YEAR_EXAMPLE,
  FiscalPeriodDto,
  FiscalYearDto,
  JOURNAL_EXAMPLE,
  JournalDto,
  JournalListQuery,
  ManualJournalDto,
  PERIOD_EXAMPLE,
  PeriodTransitionDto,
  PostingRuleDto,
  PREVIEW_EXAMPLE,
  PreviewRuleDto,
  ProposeAccountChangeDto,
  ProposeRuleVersionDto,
  ProposeTaxRateDto,
  RECURRING_EXAMPLE,
  RecurringJournalDto,
  RecurringJournalInputDto,
  ReverseJournalDto,
  RULE_EXAMPLE,
  RulePreviewDto,
  TAX_RATE_EXAMPLE,
  TaxRateDto,
} from './ledger.dto';
import { LedgerConfigService } from './ledger-config.service';
import {
  accountChangeDto,
  accountDto,
  costCentreDto,
  fiscalYearDto,
  journalDto,
  periodDto,
  recurringDto,
  ruleDto,
  taxRateDto,
} from './ledger-views';
import { ManualJournalsService } from './manual-journals.service';
import { PeriodsService } from './periods.service';
import { RecurringJournalsService } from './recurring-journals.service';

const DECISIONS = ['D-031', 'D-033'];
const MAKER_CHECKER = ['D-031', 'D-033', 'D-169'];
const WRITE = ['http.bad_request', 'http.malformed_json', 'validation.failed'] as const;

export function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('admin', 'ledgerAccounts')
@Controller('ledger')
export class AdminLedgerAccountsController {
  constructor(private readonly config: LedgerConfigService) {}

  @Get('accounts')
  @Can('ledger.read')
  @ApiEndpoint({
    id: 'admin.ledgerAccounts.list',
    summary: 'List the chart of accounts',
    description:
      'The chart of accounts of the issuing entity (accounting-design §3; codes are defaults ⚖): type, normal side, control flag (sub-ledger postings only), allowed and required dimensions.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Accounts by code', type: [AccountDto], example: [ACCOUNT_EXAMPLE] })
  @ApiStandardErrors()
  async list(): Promise<AccountDto[]> {
    return (await this.config.accounts()).map(accountDto);
  }

  @Get('account-changes')
  @Can('ledger.read')
  @ApiEndpoint({
    id: 'admin.ledgerAccounts.listChanges',
    summary: 'List chart-of-accounts change requests',
    description: 'Proposed, approved and declined changes (maker-checker `coa_change`, §8, D-169).',
    implements: MAKER_CHECKER,
  })
  @ApiSuccess(200, {
    description: 'Changes, newest first',
    type: [AccountChangeDto],
    example: [ACCOUNT_CHANGE_EXAMPLE],
  })
  @ApiStandardErrors('validation.failed')
  async changes(@Query() q: AccountChangeListQuery): Promise<AccountChangeDto[]> {
    return (await this.config.accountChanges(q.status)).map(accountChangeDto);
  }

  @Post('account-changes')
  @Can('ledger.config.propose')
  @ApiEndpoint({
    id: 'admin.ledgerAccounts.proposeChange',
    summary: 'Propose a chart-of-accounts change',
    description:
      'Create, update, deactivate (zero balance only) or reactivate an account. Applied only when a Finance Manager other than the requester approves it (policy `coa_change`, §8, D-169).',
    implements: MAKER_CHECKER,
  })
  @ApiBody({
    type: ProposeAccountChangeDto,
    examples: {
      default: {
        value: {
          kind: 'create',
          fields: {
            code: '1124',
            nameTh: 'เงินฝากธนาคาร บัญชีที่ 4',
            nameEn: 'Bank account 4',
            accountType: 'asset',
            normalSide: 'debit',
            parentCode: '1120',
            cashFlowClass: 'cash',
            allowedDimensions: ['cost_centre'],
          },
          reason: 'เปิดบัญชีธนาคารใหม่สำหรับจ่ายโรงงาน',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Change awaiting approval',
    type: AccountChangeDto,
    example: ACCOUNT_CHANGE_EXAMPLE,
  })
  @ApiStandardErrors(
    ...WRITE,
    'http.not_found',
    'ledger.account_exists',
    'ledger.account_invalid',
    'ledger.change_pending',
    'approval.no_matching_step',
  )
  async propose(
    @CurrentActor() actor: Actor,
    @Body() body: ProposeAccountChangeDto,
  ): Promise<AccountChangeDto> {
    return accountChangeDto(await this.config.proposeAccountChange(staff(actor), body));
  }

  @Get('cost-centres')
  @Can('ledger.read')
  @ApiEndpoint({
    id: 'admin.ledgerAccounts.listCostCentres',
    summary: 'List cost centres',
    description: 'Cost centres, a journal-line dimension (accounting-design §3).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Cost centres', type: [CostCentreDto], example: [COST_CENTRE_EXAMPLE] })
  @ApiStandardErrors()
  async costCentres(): Promise<CostCentreDto[]> {
    return (await this.config.costCentres()).map(costCentreDto);
  }

  @Post('cost-centres')
  @Can('ledger.config.propose')
  @ApiEndpoint({
    id: 'admin.ledgerAccounts.createCostCentre',
    summary: 'Create a cost centre',
    description: 'A new cost-centre dimension value (audited).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: CreateCostCentreDto,
    examples: { default: { value: { code: 'OPS', name: 'ฝ่ายปฏิบัติการ' } } },
  })
  @ApiSuccess(201, { description: 'Cost centre', type: CostCentreDto, example: COST_CENTRE_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'ledger.account_exists')
  async createCostCentre(
    @CurrentActor() actor: Actor,
    @Body() body: CreateCostCentreDto,
  ): Promise<CostCentreDto> {
    return costCentreDto(await this.config.createCostCentre(staff(actor), body));
  }
}

@ApiSurface('admin', 'ledgerPeriods')
@Controller('ledger')
export class AdminLedgerPeriodsController {
  constructor(
    private readonly periods: PeriodsService,
    private readonly entities: EntitiesService,
  ) {}

  @Get('fiscal-years')
  @Can('ledger.read')
  @ApiEndpoint({
    id: 'admin.ledgerPeriods.list',
    summary: 'List fiscal years and periods',
    description:
      'Fiscal years with their monthly periods `open → soft_closed → closed → locked` (accounting-design §1.4). Years are created on first use from the entity’s fiscal-year start month.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Years, newest first',
    type: [FiscalYearDto],
    example: [FISCAL_YEAR_EXAMPLE],
  })
  @ApiStandardErrors()
  async list(): Promise<FiscalYearDto[]> {
    const entityId = await this.entities.defaultEntityId();
    await this.periods.currentPeriod(entityId);
    return (await this.periods.years(entityId)).map(fiscalYearDto);
  }

  @Post('periods/:periodId/actions/:action')
  @HttpCode(200)
  @Can('ledger.periods.manage')
  @ApiParam({ name: 'periodId', format: 'uuid' })
  @ApiParam({ name: 'action', enum: ['soft-close', 'reopen', 'close', 'lock'], enumName: 'PeriodAction' })
  @ApiEndpoint({
    id: 'admin.ledgerPeriods.transition',
    summary: 'Move a period along its close sequence',
    description:
      '`soft-close` (open → soft_closed; only `ledger.post_soft_closed` may still post), `reopen` (soft_closed → open), `close` (soft_closed → closed; earlier periods first) and `lock` (closed → locked, after the auditor’s sign-off at year end). Postings dated in a period that is not open go to the next open period with their document date kept (§1.4, §7). Audited.',
    implements: DECISIONS,
  })
  @ApiBody({
    type: PeriodTransitionDto,
    examples: { default: { value: { reason: 'ปิดงวดเบื้องต้นเพื่อให้ผู้จัดการตรวจ' } } },
  })
  @ApiSuccess(200, {
    description: 'Period',
    type: FiscalPeriodDto,
    example: { ...PERIOD_EXAMPLE, status: 'soft_closed', statusChangedAt: '2026-11-02T09:00:00+07:00' },
  })
  @ApiStandardErrors(...WRITE, 'http.not_found', 'ledger.period_transition')
  async transition(
    @CurrentActor() actor: Actor,
    @Param('periodId', ParseUUIDPipe) periodId: string,
    @Param('action') action: string,
    @Body() body: PeriodTransitionDto,
  ): Promise<FiscalPeriodDto> {
    const to = ({ 'soft-close': 'soft_closed', reopen: 'open', close: 'closed', lock: 'locked' } as const)[
      action as 'soft-close'
    ];
    if (!to) throw new DomainException('http.not_found');
    return periodDto(await this.periods.transition(staff(actor), periodId, to, body.reason ?? null));
  }
}

@ApiSurface('admin', 'journals')
@Controller('ledger/journals')
export class AdminJournalsController {
  constructor(
    private readonly journals: ManualJournalsService,
    private readonly query: JournalsQueryService,
  ) {}

  @Get()
  @Can('ledger.read')
  @ApiEndpoint({
    id: 'admin.journals.list',
    summary: 'List journal entries',
    description:
      'Automatic, manual, recurring and reversing entries with their lines; filter by account, period, source document or domain event to drill down from a report number to its journals (§1.7).',
    implements: DECISIONS,
  })
  @ApiPaginated(JournalDto, { example: JOURNAL_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@Query() q: JournalListQuery) {
    const { rows, total } = await this.query.list(q);
    return { data: rows.map(journalDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Get(':journalId')
  @Can('ledger.read')
  @ApiEtag()
  @ApiParam({ name: 'journalId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.journals.get',
    summary: 'Get a journal entry',
    description:
      'The entry with its lines, dimensions and tax tagging, the posting rule version, the source document and the domain event it came from, maker and checker (§1.2, §1.7). Drafts return an `ETag` for `If-Match` edits.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Journal entry', type: JournalDto, example: JOURNAL_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @Param('journalId', ParseUUIDPipe) journalId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<JournalDto> {
    const row = await this.journals.get(journalId);
    res.setHeader('ETag', ManualJournalsService.etag(row));
    return journalDto(row);
  }

  @Post()
  @Can('ledger.journals.manage')
  @ApiEndpoint({
    id: 'admin.journals.create',
    summary: 'Draft a manual journal',
    description:
      'A balanced manual journal on postable, non-control accounts with the dimensions each account requires (control accounts take sub-ledger postings only, §3). It posts only after submission and another person’s approval (§1.1, §8, D-169).',
    implements: MAKER_CHECKER,
  })
  @ApiBody({
    type: ManualJournalDto,
    examples: {
      default: {
        value: {
          documentDate: '2026-10-31',
          description: 'ตั้งค่าเช่าคลังค้างจ่าย ตุลาคม 2569',
          autoReverseOn: '2026-11-01',
          lines: [
            { accountCode: '6900', side: 'debit', amount: '15000.00', description: 'ค่าเช่าคลัง' },
            { accountCode: '2410', side: 'credit', amount: '15000.00' },
          ],
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Draft',
    type: JournalDto,
    example: {
      ...JOURNAL_EXAMPLE,
      kind: 'manual',
      status: 'draft',
      entryNo: null,
      postingRule: null,
      postingRuleVersion: null,
      source: null,
      domainEventId: null,
    },
  })
  @ApiStandardErrors(...WRITE, 'ledger.account_invalid', 'ledger.unbalanced')
  async create(
    @CurrentActor() actor: Actor,
    @Body() body: ManualJournalDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<JournalDto> {
    const row = await this.journals.create(staff(actor), body);
    res.setHeader('ETag', ManualJournalsService.etag(row));
    return journalDto(row);
  }

  @Put(':journalId')
  @Can('ledger.journals.manage')
  @ApiConcurrency()
  @ApiParam({ name: 'journalId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.journals.update',
    summary: 'Edit a draft manual journal',
    description: 'Only the maker edits a draft, with `If-Match` (§8).',
    implements: MAKER_CHECKER,
  })
  @ApiBody({
    type: ManualJournalDto,
    examples: {
      default: {
        value: {
          documentDate: '2026-10-31',
          description: 'ตั้งค่าเช่าคลังค้างจ่าย',
          lines: [
            { accountCode: '6900', side: 'debit', amount: '16000.00' },
            { accountCode: '2410', side: 'credit', amount: '16000.00' },
          ],
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Draft',
    type: JournalDto,
    example: { ...JOURNAL_EXAMPLE, kind: 'manual', status: 'draft' },
  })
  @ApiStandardErrors(
    ...WRITE,
    'http.not_found',
    'ledger.journal_not_editable',
    'ledger.account_invalid',
    'ledger.unbalanced',
  )
  async update(
    @CurrentActor() actor: Actor,
    @Param('journalId', ParseUUIDPipe) journalId: string,
    @IfMatch() ifMatch: string | undefined,
    @Body() body: ManualJournalDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<JournalDto> {
    const row = await this.journals.update(staff(actor), journalId, ifMatch, body);
    res.setHeader('ETag', ManualJournalsService.etag(row));
    return journalDto(row);
  }

  @Delete(':journalId')
  @HttpCode(204)
  @Can('ledger.journals.manage')
  @ApiParam({ name: 'journalId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.journals.discard',
    summary: 'Discard a draft manual journal',
    description: 'A draft never submitted is removed by its maker; submitted journals are kept (§1.2).',
    implements: MAKER_CHECKER,
  })
  @ApiSuccess(204, { description: 'Discarded' })
  @ApiStandardErrors('http.not_found', 'ledger.journal_not_editable')
  async discard(
    @CurrentActor() actor: Actor,
    @Param('journalId', ParseUUIDPipe) journalId: string,
  ): Promise<void> {
    await this.journals.discard(staff(actor), journalId);
  }

  @Post(':journalId/actions/submit')
  @HttpCode(200)
  @Can('ledger.journals.manage')
  @Idempotent()
  @ApiParam({ name: 'journalId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.journals.submit',
    summary: 'Submit a manual journal for approval',
    description:
      'The maker submits; a Finance Manager other than the maker approves (policy `manual_journal`, D-169) and the approval posts it with a JV number — into the next open period when its own is closed (§1.4). Requires `Idempotency-Key`.',
    implements: MAKER_CHECKER,
  })
  @ApiSuccess(200, {
    description: 'Awaiting approval',
    type: JournalDto,
    example: { ...JOURNAL_EXAMPLE, kind: 'manual', status: 'pending_approval' },
  })
  @ApiStandardErrors(
    'http.not_found',
    'ledger.journal_not_editable',
    'numbering.series_missing',
    'approval.no_matching_step',
  )
  async submit(
    @CurrentActor() actor: Actor,
    @Param('journalId', ParseUUIDPipe) journalId: string,
  ): Promise<JournalDto> {
    return journalDto(await this.journals.submit(staff(actor), journalId));
  }

  @Post(':journalId/actions/reverse')
  @HttpCode(201)
  @Can('ledger.journals.manage')
  @Idempotent()
  @ApiParam({ name: 'journalId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.journals.reverse',
    summary: 'Request the reversal of a posted journal',
    description:
      'Corrections are reversing entries linked to the original (§1.2). Manual and recurring entries only — sub-ledger entries are corrected by their documents (void, credit note). The reversal is approved like a manual journal (D-169). Requires `Idempotency-Key`.',
    implements: MAKER_CHECKER,
  })
  @ApiBody({
    type: ReverseJournalDto,
    examples: { default: { value: { documentDate: '2026-11-01', reason: 'บันทึกผิดบัญชี' } } },
  })
  @ApiSuccess(201, {
    description: 'Reversal awaiting approval',
    type: JournalDto,
    example: { ...JOURNAL_EXAMPLE, kind: 'reversal', status: 'pending_approval' },
  })
  @ApiStandardErrors(
    ...WRITE,
    'http.not_found',
    'ledger.not_reversible',
    'numbering.series_missing',
    'approval.no_matching_step',
  )
  async reverse(
    @CurrentActor() actor: Actor,
    @Param('journalId', ParseUUIDPipe) journalId: string,
    @Body() body: ReverseJournalDto,
  ): Promise<JournalDto> {
    return journalDto(await this.journals.requestReversal(staff(actor), journalId, body));
  }
}

@ApiSurface('admin', 'recurringJournals')
@Controller('ledger/recurring-journals')
export class AdminRecurringJournalsController {
  constructor(private readonly recurring: RecurringJournalsService) {}

  @Get()
  @Can('ledger.read')
  @ApiEndpoint({
    id: 'admin.recurringJournals.list',
    summary: 'List recurring journals',
    description: 'Recurring journal definitions with their next run date (B5.1).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Definitions', type: [RecurringJournalDto], example: [RECURRING_EXAMPLE] })
  @ApiStandardErrors()
  async list(): Promise<RecurringJournalDto[]> {
    return (await this.recurring.list()).map(recurringDto);
  }

  @Post()
  @Can('ledger.journals.manage')
  @ApiEndpoint({
    id: 'admin.recurringJournals.create',
    summary: 'Define a recurring journal',
    description:
      'Posted every month on its day once approved by a Finance Manager (policy `recurring_journal`, D-169), optionally reversed on the first day of the next month (accruals, §7 step 6).',
    implements: MAKER_CHECKER,
  })
  @ApiBody({
    type: RecurringJournalInputDto,
    examples: {
      default: {
        value: {
          name: 'ค่าเช่าสำนักงานรายเดือน',
          description: 'ตั้งค่าเช่าสำนักงานค้างจ่ายทุกสิ้นเดือน',
          dayOfMonth: 28,
          startOn: '2026-10-01',
          autoReverse: true,
          lines: [
            { accountCode: '6900', side: 'debit', amount: '15000.00' },
            { accountCode: '2410', side: 'credit', amount: '15000.00' },
          ],
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Awaiting approval',
    type: RecurringJournalDto,
    example: { ...RECURRING_EXAMPLE, status: 'pending_approval' },
  })
  @ApiStandardErrors(...WRITE, 'ledger.account_invalid', 'ledger.unbalanced', 'approval.no_matching_step')
  async create(
    @CurrentActor() actor: Actor,
    @Body() body: RecurringJournalInputDto,
  ): Promise<RecurringJournalDto> {
    return recurringDto(await this.recurring.create(staff(actor), body));
  }

  @Post(':recurringId/actions/:action')
  @HttpCode(200)
  @Can('ledger.periods.manage')
  @ApiParam({ name: 'recurringId', format: 'uuid' })
  @ApiParam({ name: 'action', enum: ['pause', 'resume', 'end'], enumName: 'RecurringJournalAction' })
  @ApiEndpoint({
    id: 'admin.recurringJournals.setStatus',
    summary: 'Pause, resume or end a recurring journal',
    description: 'Finance Manager; audited.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Definition',
    type: RecurringJournalDto,
    example: { ...RECURRING_EXAMPLE, status: 'paused' },
  })
  @ApiStandardErrors('http.not_found', 'ledger.journal_not_editable')
  async setStatus(
    @CurrentActor() actor: Actor,
    @Param('recurringId', ParseUUIDPipe) recurringId: string,
    @Param('action') action: string,
  ): Promise<RecurringJournalDto> {
    const to = ({ pause: 'paused', resume: 'active', end: 'ended' } as const)[action as 'pause'];
    if (!to) throw new DomainException('http.not_found');
    return recurringDto(await this.recurring.setStatus(staff(actor), recurringId, to));
  }
}

@ApiSurface('admin', 'postingRules')
@Controller('ledger/posting-rules')
export class AdminPostingRulesController {
  constructor(private readonly config: LedgerConfigService) {}

  @Get()
  @Can('ledger.read')
  @ApiEndpoint({
    id: 'admin.postingRules.list',
    summary: 'List posting rules',
    description:
      'The rules that turn sub-ledger events into journals (P01–P30 of accounting-design §5 and the supplementary rules of ADR-0007), each with its versions.',
    implements: ['D-033', 'ADR-0007'],
  })
  @ApiSuccess(200, { description: 'Rules by key', type: [PostingRuleDto], example: [RULE_EXAMPLE] })
  @ApiStandardErrors()
  async list(): Promise<PostingRuleDto[]> {
    return (await this.config.rules()).map(ruleDto);
  }

  @Get(':key')
  @Can('ledger.read')
  @ApiParam({ name: 'key', example: 'P01' })
  @ApiEndpoint({
    id: 'admin.postingRules.get',
    summary: 'Get a posting rule',
    description: 'The rule with every version: conditions, template, status and approval.',
    implements: ['D-033', 'ADR-0007'],
  })
  @ApiSuccess(200, { description: 'Rule', type: PostingRuleDto, example: RULE_EXAMPLE })
  @ApiStandardErrors('http.not_found')
  async get(@Param('key') key: string): Promise<PostingRuleDto> {
    return ruleDto(await this.config.rule(key));
  }

  @Post(':key/versions')
  @Can('ledger.config.propose')
  @ApiParam({ name: 'key', example: 'P01' })
  @ApiEndpoint({
    id: 'admin.postingRules.proposeVersion',
    summary: 'Propose a new posting-rule version',
    description:
      'A validated template (accounts must exist and be postable) effective from now or later, applied when a Finance Manager other than the requester approves (policy `posting_rule_change`, §8, D-169). Postings keep the version they used.',
    implements: ['D-033', 'D-169', 'ADR-0007'],
  })
  @ApiBody({
    type: ProposeRuleVersionDto,
    examples: {
      default: {
        value: {
          effectiveFrom: '2026-11-01T00:00:00+07:00',
          template: {
            description: 'TR {docNumber}',
            documentDate: 'documentDate',
            lines: [
              { account: '1132', side: 'debit', amount: 'grossAmount' },
              { account: '2310', side: 'credit', amount: 'grossAmount' },
            ],
          },
          reason: 'ผู้สอบบัญชีให้แยกบัญชีพักตามธนาคาร',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Rule with the proposed version',
    type: PostingRuleDto,
    example: RULE_EXAMPLE,
  })
  @ApiStandardErrors(
    ...WRITE,
    'http.not_found',
    'ledger.rule_invalid',
    'ledger.change_pending',
    'approval.no_matching_step',
  )
  async propose(
    @CurrentActor() actor: Actor,
    @Param('key') key: string,
    @Body() body: ProposeRuleVersionDto,
  ): Promise<PostingRuleDto> {
    return ruleDto(
      await this.config.proposeRuleVersion(staff(actor), key, {
        effectiveFrom: new Date(body.effectiveFrom),
        conditions: body.conditions ?? null,
        template: body.template,
        reason: body.reason,
      }),
    );
  }

  @Post(':key/actions/preview')
  @HttpCode(200)
  @Can('ledger.read')
  @ApiParam({ name: 'key', example: 'P01' })
  @ApiEndpoint({
    id: 'admin.postingRules.preview',
    summary: 'Preview a rule on a sample event',
    description:
      'Renders the rule version (in force, or the one named) on a sample payload without posting: whether it applies, its lines and whether they balance.',
    implements: ['D-033', 'ADR-0007'],
  })
  @ApiBody({
    type: PreviewRuleDto,
    examples: {
      default: {
        value: {
          payload: {
            docType: 'tr',
            docKind: 'instalment',
            receiptVia: 'scb',
            docNumber: 'TR256910-00001',
            grossAmount: '1070.00',
            netAmount: '1000.00',
            vatAmount: '70.00',
          },
        },
      },
    },
  })
  @ApiSuccess(200, { description: 'Rendered journal', type: RulePreviewDto, example: PREVIEW_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'http.not_found', 'ledger.rule_invalid')
  async preview(@Param('key') key: string, @Body() body: PreviewRuleDto): Promise<RulePreviewDto> {
    const { rule, version, applies, journal } = await this.config.previewRule(
      key,
      body.payload,
      body.versionNo,
    );
    return {
      key: rule.key,
      versionNo: version.versionNo,
      applies,
      balanced: journal.totalDebit.eq(journal.totalCredit),
      description: journal.description,
      totalDebit: formatMoney(journal.totalDebit),
      totalCredit: formatMoney(journal.totalCredit),
      lines: journal.lines.map((l) => ({
        accountCode: l.accountCode,
        side: l.side,
        amount: formatMoney(l.amount),
        taxCode: l.taxCode,
        taxBase: l.taxBase ? formatMoney(l.taxBase) : null,
      })),
    };
  }
}

@ApiSurface('admin', 'taxRates')
@Controller('tax/rates')
export class AdminTaxRatesController {
  constructor(private readonly config: LedgerConfigService) {}

  @Get()
  @Can('ledger.read')
  @ApiEndpoint({
    id: 'admin.taxRates.list',
    summary: 'List tax rates',
    description:
      'VAT and withholding rates with their dated versions (accounting-design §2 ⚖): customer withholding (D-174) and vendor withholding per line type — production 3 %, transport 1 %, services 3 % by default.',
    implements: ['D-033', 'D-174'],
  })
  @ApiSuccess(200, { description: 'Rates by code', type: [TaxRateDto], example: [TAX_RATE_EXAMPLE] })
  @ApiStandardErrors()
  async list(): Promise<TaxRateDto[]> {
    return (await this.config.taxRates()).map(taxRateDto);
  }

  @Post(':code/versions')
  @Can('ledger.config.propose')
  @ApiParam({ name: 'code', example: 'vat_standard' })
  @ApiEndpoint({
    id: 'admin.taxRates.proposeVersion',
    summary: 'Propose a new tax-rate version',
    description:
      'Rates change by dated versions, never in place; applied when a Finance Manager other than the requester approves (policy `tax_setting_change`, §8, D-169). Not back-dated.',
    implements: ['D-033', 'D-169'],
  })
  @ApiBody({
    type: ProposeTaxRateDto,
    examples: {
      default: {
        value: {
          ratePct: '7',
          effectiveFrom: '2027-01-01T00:00:00+07:00',
          reason: 'พระราชกฤษฎีกาลดอัตราภาษีมูลค่าเพิ่ม',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Rate with the proposed version',
    type: TaxRateDto,
    example: TAX_RATE_EXAMPLE,
  })
  @ApiStandardErrors(
    ...WRITE,
    'http.not_found',
    'settings.backdated',
    'ledger.change_pending',
    'approval.no_matching_step',
  )
  async propose(
    @CurrentActor() actor: Actor,
    @Param('code') code: string,
    @Body() body: ProposeTaxRateDto,
  ): Promise<TaxRateDto> {
    return taxRateDto(
      await this.config.proposeTaxRate(staff(actor), code, {
        ratePct: body.ratePct,
        effectiveFrom: new Date(body.effectiveFrom),
        reason: body.reason,
      }),
    );
  }
}
