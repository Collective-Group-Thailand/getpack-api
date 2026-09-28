import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney } from '@common/money/money';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import { CompaniesService } from './companies.service';
import {
  CompanyCreditDto,
  CREDIT_EXAMPLE,
  RequestCreditLimitDto,
  STATEMENT_EXAMPLE,
  StatementDto,
  StatementQuery,
} from './credit.dto';
import { CreditService, type CreditView, type StatementData } from './credit.service';

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
  ) {}

  @Get('credit')
  @Can('companies.read')
  @companyParam
  @ApiEndpoint({
    id: 'admin.companyCredit.get',
    summary: 'Get a company’s credit',
    description: 'Status, limit, term, exposure, available and a pending request (D-121).',
    implements: ['D-121'],
  })
  @ApiSuccess(200, { description: 'Credit', type: CompanyCreditDto, example: CREDIT_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(@Param('companyId', ParseUUIDPipe) id: string): Promise<CompanyCreditDto> {
    return creditDto(await this.credit.view((await this.companies.get(id)).id));
  }

  @Post('credit-limits')
  @Can('company_credit.manage')
  @companyParam
  @ApiEndpoint({
    id: 'admin.companyCredit.requestLimit',
    summary: 'Request a credit limit and term',
    description:
      'For an eligible company (3 paid orders) or after a verified financial statement (D-121). Routed by ' +
      '`credit_limit`: Finance up to THB 100,000, C-Level above; the requester cannot approve. Terms from ' +
      '`b2b.credit_terms` (15 / 30 / 45 / 60, default 30).',
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
  async request(
    @CurrentActor() actor: Actor,
    @Param('companyId', ParseUUIDPipe) id: string,
    @Body() body: RequestCreditLimitDto,
  ): Promise<CompanyCreditDto> {
    return creditDto(await this.credit.requestLimit(staff(actor), id, body));
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
