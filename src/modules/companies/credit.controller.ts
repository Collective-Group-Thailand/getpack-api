import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { formatMoney } from '@common/money/money';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import { CompanySpendDto, CompanySpendQuery, SPEND_EXAMPLE } from './companies.dto';
import { CompaniesService } from './companies.service';
import {
  ADMIN_CREDIT_EXAMPLE,
  AdminCompanyCreditDto,
  ApplyForCreditDto,
  CompanyCreditDto,
  CompanyReceivablesDto,
  CREDIT_EXAMPLE,
  ISSUED_STATEMENT_EXAMPLE,
  IssuedStatementDto,
  RECEIVABLES_EXAMPLE,
  RequestCreditLimitDto,
  STATEMENT_EXAMPLE,
  StatementDto,
  StatementQuery,
} from './credit.dto';
import { CreditService, type CreditView, type ReceivablesView, type StatementData } from './credit.service';

type LimitVersionRow = Awaited<ReturnType<CreditService['versions']>>[number];

const companyParam = ApiParam({ name: 'companyId', format: 'uuid' });

function creditDto(v: CreditView): CompanyCreditDto {
  return {
    creditStatus: v.creditStatus,
    limitAmount: v.limit?.limitAmount.toFixed(2) ?? null,
    termDays: v.limit?.termDays ?? null,
    exposureAmount: formatMoney(v.exposure),
    availableAmount: formatMoney(v.available),
    pendingRequest: v.pending
      ? {
          limitAmount: v.pending.limitAmount.toFixed(2),
          termDays: v.pending.termDays,
          requestedAt: toBangkokIso(v.pending.createdAt),
        }
      : null,
    eligibility: v.eligibility,
    currency: 'THB',
  };
}

function adminCreditDto(v: CreditView, versions: LimitVersionRow[]): AdminCompanyCreditDto {
  const base = creditDto(v);
  const pending = v.pending ? versions.find((x) => x.id === v.pending!.id) : undefined;
  return {
    ...base,
    pendingRequest:
      base.pendingRequest && pending
        ? {
            ...base.pendingRequest,
            versionNo: pending.versionNo,
            approvalId: pending.approvalRequest?.publicId ?? null,
          }
        : null,
    versions: versions.map((x) => ({
      id: x.publicId,
      versionNo: x.versionNo,
      status: x.status,
      limitAmount: x.limitAmount.toFixed(2),
      termDays: x.termDays,
      basis: x.eligibilityBasis,
      reason: x.reason,
      effectiveFrom: toBangkokIso(x.effectiveFrom),
      requestedBy: x.createdBy ? { id: x.createdBy.publicId, displayName: x.createdBy.displayName } : null,
      requestedAt: toBangkokIso(x.createdAt),
      approvalId: x.approvalRequest?.publicId ?? null,
      decidedAt: x.decidedAt ? toBangkokIso(x.decidedAt) : null,
    })),
  };
}

type StatementRow = Awaited<ReturnType<PrismaService['companyStatement']['findMany']>>[number];

function issuedStatementDto(r: StatementRow): IssuedStatementDto {
  return {
    id: r.publicId,
    month: r.periodMonth.toISOString().slice(0, 7),
    openingAmount: r.opening.toFixed(2),
    invoicedAmount: r.invoiced.toFixed(2),
    paidAmount: r.paid.toFixed(2),
    creditedAmount: r.credited.toFixed(2),
    closingAmount: r.closing.toFixed(2),
    pdfReady: r.fileObjectId !== null,
    generatedAt: toBangkokIso(r.generatedAt),
    sentAt: r.sentAt ? toBangkokIso(r.sentAt) : null,
    currency: 'THB',
  };
}

function receivablesDto(r: ReceivablesView): CompanyReceivablesDto {
  return {
    asOf: r.asOf,
    openAmount: formatMoney(r.open),
    overdueAmount: formatMoney(r.overdue),
    aging: {
      current: formatMoney(r.aging.current),
      d1_30: formatMoney(r.aging.d1_30),
      d31_60: formatMoney(r.aging.d31_60),
      d61_90: formatMoney(r.aging.d61_90),
      over_90: formatMoney(r.aging.over_90),
    },
    oldestOverdueDays: r.oldestOverdueDays,
    nextDueAt: r.nextDueAt ? toBangkokIso(r.nextDueAt) : null,
    creditOrdersBlocked: r.creditOrdersBlocked,
    notices: r.notices.map((n) => ({
      code: n.code,
      groupCode: n.groupCode,
      dueAt: n.dueAt ? toBangkokIso(n.dueAt) : null,
      amount: n.amount ? formatMoney(n.amount) : null,
    })),
    currency: 'THB',
  };
}

function statementDto(month: string, s: StatementData): StatementDto {
  return {
    month,
    lines: s.lines.map((l) => ({
      groupId: l.group.publicId,
      groupCode: l.group.groupCode,
      placedAt: toBangkokIso(l.group.placedAt),
      branchCode: l.group.companyBranch?.branchCode ?? null,
      poNumber: l.group.poNumber,
      grossAmount: formatMoney(l.gross),
      paidAmount: formatMoney(l.paid),
      openAmount: formatMoney(l.open),
      dueAt: l.dueAt ? toBangkokIso(l.dueAt) : null,
    })),
    totalGrossAmount: formatMoney(s.totalGross),
    totalPaidAmount: formatMoney(s.totalPaid),
    openBalance: formatMoney(s.openBalance),
    currency: 'THB',
  };
}

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

function staff(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'staff') throw new DomainException('auth.forbidden');
  return actor;
}

@ApiSurface('store', 'companyCredit')
@Controller('companies/:companyId')
export class StoreCompanyCreditController {
  constructor(
    private readonly companies: CompaniesService,
    private readonly credit: CreditService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('credit')
  @companyParam
  @ApiEndpoint({
    id: 'store.companyCredit.get',
    summary: 'Get my company’s credit',
    description:
      'Company Admin / Accountant: status, limit, term, what is open and available (D-121, D-122).',
    implements: ['D-121', 'D-122'],
  })
  @ApiSuccess(200, { description: 'Credit', type: CompanyCreditDto, example: CREDIT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
  ): Promise<CompanyCreditDto> {
    const company = await this.companies.forMember(customer(actor), id, 'company_documents.read');
    return creditDto(await this.credit.view(company.id));
  }

  @Post('credit-applications')
  @Idempotent()
  @companyParam
  @ApiEndpoint({
    id: 'store.companyCredit.apply',
    summary: 'Apply for company credit',
    description:
      'Company Admin: a credit limit and term (one of `eligibility.allowedTermDays`) on the basis of the paid orders ' +
      '(once eligible) or of a financial statement added as a KYC document. It goes to the `credit_limit` approval ' +
      '(Finance up to THB 100,000, C-Level above, D-121); `pendingRequest` shows it until decided. 409 ' +
      '`companies.credit_not_eligible` when not eligible, `approval.already_pending` while one is waiting.',
    implements: ['D-121'],
  })
  @ApiBody({
    type: ApplyForCreditDto,
    examples: {
      default: {
        value: { limitAmount: '100000.00', termDays: 30, basis: 'paid_orders', note: 'สั่งซื้อทุกเดือน' },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Credit with the pending request',
    type: CompanyCreditDto,
    example: {
      ...CREDIT_EXAMPLE,
      creditStatus: 'eligible',
      limitAmount: null,
      termDays: null,
      pendingRequest: { limitAmount: '100000.00', termDays: 30, requestedAt: '2026-10-05T10:00:00+07:00' },
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'companies.invalid_status',
    'companies.credit_not_eligible',
    'approval.already_pending',
  )
  async apply(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
    @Body() body: ApplyForCreditDto,
  ): Promise<CompanyCreditDto> {
    const me = customer(actor);
    await this.companies.forMember(me, id, 'company_profile.manage');
    return creditDto(
      await this.credit.requestLimit(
        me,
        id,
        { limitAmount: body.limitAmount, termDays: body.termDays, basis: body.basis, reason: body.note },
        { statementOnFile: true },
      ),
    );
  }

  @Get('receivables')
  @companyParam
  @ApiEndpoint({
    id: 'store.companyCredit.receivables',
    summary: 'What my company owes',
    description:
      'Company Admin / Accountant: open receivables by days past due (current, 1–30, 31–60, 61–90, over 90), the ' +
      'credit exposure, the next due credit instalment and the D-122 notices — due within the reminder window, due ' +
      'today, overdue, credit orders blocked.',
    implements: ['D-122', 'D-121'],
  })
  @ApiSuccess(200, { description: 'Receivables', type: CompanyReceivablesDto, example: RECEIVABLES_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async receivables(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
  ): Promise<CompanyReceivablesDto> {
    const company = await this.companies.forMember(customer(actor), id, 'company_documents.read');
    return receivablesDto(await this.credit.owed(company.id));
  }

  @Get('issued-statements')
  @companyParam
  @ApiEndpoint({
    id: 'store.companyCredit.listStatements',
    summary: 'List my company’s issued statements',
    description:
      'Company Admin / Accountant: the monthly statements issued so far, newest first (at most 24), with their ' +
      'balances and whether the PDF is ready (`store.documents.companyStatementPdf`, D-125).',
    implements: ['D-125'],
  })
  @ApiSuccess(200, {
    description: 'Statements',
    type: [IssuedStatementDto],
    example: [ISSUED_STATEMENT_EXAMPLE],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async statements(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
  ): Promise<IssuedStatementDto[]> {
    const company = await this.companies.forMember(customer(actor), id, 'company_documents.read');
    const rows = await this.prisma.companyStatement.findMany({
      where: { companyId: company.id },
      orderBy: { periodMonth: 'desc' },
      take: 24,
    });
    return rows.map(issuedStatementDto);
  }

  @Get('spend')
  @companyParam
  @ApiEndpoint({
    id: 'store.companies.spend',
    summary: 'What my company ordered',
    description:
      'Company Admin / Accountant: placed orders of the last `months` calendar months (default 12, Bangkok) — net ' +
      '(before VAT, shipping included), VAT and gross — by month, member, invoice branch and product type. ' +
      'Cancelled orders and orders waiting for the company approver are not counted (D-125).',
    implements: ['D-125'],
  })
  @ApiSuccess(200, { description: 'Spend', type: CompanySpendDto, example: SPEND_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  spend(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
    @Query() q: CompanySpendQuery,
  ): Promise<CompanySpendDto> {
    return this.companies.spend(customer(actor), id, q.months ?? 12);
  }

  @Get('statement')
  @companyParam
  @ApiEndpoint({
    id: 'store.companyCredit.statement',
    summary: 'Get my company’s monthly statement',
    description:
      'Company Admin / Accountant: the month’s orders with paid and open amounts and the open balance, for consolidated payment (D-125). The PDF arrives with B5.2.',
    implements: ['D-125'],
  })
  @ApiSuccess(200, { description: 'Statement', type: StatementDto, example: STATEMENT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async statement(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
    @Query() q: StatementQuery,
  ): Promise<StatementDto> {
    const company = await this.companies.forMember(customer(actor), id, 'company_documents.read');
    return statementDto(q.month, await this.credit.statement(company.id, q.month));
  }
}

@ApiSurface('admin', 'companyCredit')
@Controller('companies/:companyId')
export class AdminCompanyCreditController {
  constructor(
    private readonly companies: CompaniesService,
    private readonly credit: CreditService,
    private readonly prisma: PrismaService,
  ) {}

  private async adminView(companyId: bigint, v?: CreditView): Promise<AdminCompanyCreditDto> {
    const [view, versions] = await Promise.all([
      v ?? this.credit.view(companyId),
      this.credit.versions(companyId),
    ]);
    return adminCreditDto(view, versions);
  }

  @Get('credit')
  @Can('companies.read')
  @companyParam
  @ApiEndpoint({
    id: 'admin.companyCredit.get',
    summary: 'Get a company’s credit',
    description:
      'Status, limit, term, exposure, available, eligibility with its reason, the pending request with its ' +
      'version and approval, and every limit version newest first (D-121).',
    implements: ['D-121'],
  })
  @ApiSuccess(200, { description: 'Credit', type: AdminCompanyCreditDto, example: ADMIN_CREDIT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('companyId', ParseUUIDPipe) id: string): Promise<AdminCompanyCreditDto> {
    return this.adminView((await this.companies.get(id)).id);
  }

  @Get('receivables')
  @Can('companies.read')
  @companyParam
  @ApiEndpoint({
    id: 'admin.companyCredit.receivables',
    summary: 'What a company owes',
    description:
      'Open receivables by days past due, the credit exposure, the next due credit instalment and the D-122 ' +
      'notices — the view the company’s Admin and Accountant see.',
    implements: ['D-122', 'D-121'],
  })
  @ApiSuccess(200, { description: 'Receivables', type: CompanyReceivablesDto, example: RECEIVABLES_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async receivables(@Param('companyId', ParseUUIDPipe) id: string): Promise<CompanyReceivablesDto> {
    return receivablesDto(await this.credit.owed((await this.companies.get(id)).id));
  }

  @Get('issued-statements')
  @Can('companies.read')
  @companyParam
  @ApiEndpoint({
    id: 'admin.companyCredit.listStatements',
    summary: 'List a company’s issued statements',
    description:
      'The monthly statements issued so far, newest first (at most 24), with their balances and whether the PDF ' +
      'is ready (`admin.receivables.companyStatementPdf`, D-125). A statement has no due date of its own: each ' +
      'invoice keeps its credit term (D-121).',
    implements: ['D-125'],
  })
  @ApiSuccess(200, {
    description: 'Statements',
    type: [IssuedStatementDto],
    example: [ISSUED_STATEMENT_EXAMPLE],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async statements(@Param('companyId', ParseUUIDPipe) id: string): Promise<IssuedStatementDto[]> {
    const company = await this.companies.get(id);
    const rows = await this.prisma.companyStatement.findMany({
      where: { companyId: company.id },
      orderBy: { periodMonth: 'desc' },
      take: 24,
    });
    return rows.map(issuedStatementDto);
  }

  @Post('credit-limits')
  @Idempotent({ optional: true })
  @Can('company_credit.manage')
  @companyParam
  @ApiEndpoint({
    id: 'admin.companyCredit.requestLimit',
    summary: 'Request a credit limit and term',
    description:
      'For an eligible company (3 paid orders) or after a verified financial statement (D-121). Routed by ' +
      '`credit_limit`: Finance up to THB 100,000, C-Level above; the requester cannot approve. Terms from ' +
      '`b2b.credit_terms` (15 / 30 / 45 / 60, default 30). The response carries the new version and its ' +
      'approval. The verified financial statement is a KYC document, so the request takes no evidence files.',
    implements: ['D-121'],
  })
  @ApiBody({
    type: RequestCreditLimitDto,
    examples: {
      default: {
        value: {
          limitAmount: '100000.00',
          termDays: 30,
          basis: 'paid_orders',
          reason: 'ชำระตรงเวลา 3 ครั้ง',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Credit with the pending request',
    type: AdminCompanyCreditDto,
    example: {
      ...ADMIN_CREDIT_EXAMPLE,
      creditStatus: 'eligible',
      limitAmount: null,
      termDays: null,
      pendingRequest: {
        limitAmount: '100000.00',
        termDays: 30,
        requestedAt: '2026-10-05T10:00:00+07:00',
        versionNo: 1,
        approvalId: '0192f3a0-7c1e-7d2a-9b1f-0000000c1030',
      },
      versions: [{ ...ADMIN_CREDIT_EXAMPLE.versions[0]!, status: 'proposed', decidedAt: null }],
    },
  })
  @ApiStandardErrors(
    'http.bad_request',
    'http.malformed_json',
    'http.not_found',
    'validation.failed',
    'companies.invalid_status',
    'companies.credit_not_eligible',
    'approval.already_pending',
  )
  async request(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
    @Body() body: RequestCreditLimitDto,
  ): Promise<AdminCompanyCreditDto> {
    const view = await this.credit.requestLimit(staff(actor), id, body);
    return this.adminView((await this.companies.get(id)).id, view);
  }

  @Get('statement')
  @Can('companies.read')
  @companyParam
  @ApiEndpoint({
    id: 'admin.companyCredit.statement',
    summary: 'Get a company’s monthly statement',
    description: 'Orders of the month, paid and open amounts, open balance (D-125).',
    implements: ['D-125'],
  })
  @ApiSuccess(200, { description: 'Statement', type: StatementDto, example: STATEMENT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async statement(
    @Param('companyId', ParseUUIDPipe) id: string,
    @Query() q: StatementQuery,
  ): Promise<StatementDto> {
    return statementDto(q.month, await this.credit.statement((await this.companies.get(id)).id, q.month));
  }
}
