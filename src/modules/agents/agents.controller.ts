import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { PageQuery } from '@common/pagination/pagination.dto';
import { AttributeReferralDto } from '@modules/promotions/referrals.dto';
import { ApiSurface } from '@modules/surfaces/surfaces';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { DownloadUrlDto } from '@platform/files/files.dto';
import { type Request } from 'express';

import { AgentAttributionService } from './agent-attribution.service';
import { AgentCommissionsService } from './agent-commissions.service';
import { AgentStatementsService } from './agent-statements.service';
import {
  AGENT_EXAMPLE,
  AGENT_IDS,
  AGENT_LINK_EXAMPLE,
  AGENT_PROGRAMME_EXAMPLE,
  AgentApplicationDto,
  AgentCommissionDto,
  AgentDto,
  AgentLeadDto,
  AgentLinkDto,
  AgentProgrammeDto,
  AgentStatementDetailDto,
  AgentStatementDto,
  APPLICATION_EXAMPLE,
  ClaimedAgentLinkDto,
  COMMISSION_EXAMPLE,
  LEAD_EXAMPLE,
  MyCommissionListQuery,
  MyLeadListQuery,
  MyLinkListQuery,
  RegisterAgentLeadDto,
  STATEMENT_DETAIL_EXAMPLE,
  STATEMENT_EXAMPLE,
  SubmitAgentApplicationDto,
} from './agents.dto';
import { AgentsService } from './agents.service';
import { agentDto, agentLinkDto, applicationDto, commissionDto, leadDto, statementDto } from './agents-views';

const DECISIONS = ['D-416', 'D-417', 'D-418', 'D-420', 'D-422'];
const WRITE = ['http.bad_request', 'http.malformed_json', 'validation.failed'] as const;

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

/**
 * The agent pages of the storefront (D-416 – D-422): any signed-in customer reads the programme, applies
 * and claims an agent link; an approved agent (`agent.self`) works their link, leads, customers,
 * commission and statements. An agent sees only their own rows; customers who came through the link show
 * masked (D-422).
 */
@ApiSurface('store', 'agent')
@Controller('agent')
export class StoreAgentController {
  constructor(
    private readonly agents: AgentsService,
    private readonly attribution: AgentAttributionService,
    private readonly commissions: AgentCommissionsService,
    private readonly statements: AgentStatementsService,
  ) {}

  @Get('programme')
  @ApiEndpoint({
    id: 'store.agent.programme',
    summary: 'Read the agent programme',
    description:
      'The agent agreement in force, the standard freelance plan’s terms, the programme rules and where the ' +
      'signed-in customer stands (none, applied, rejected, withdrawn, agent) (D-416, D-418).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Programme', type: AgentProgrammeDto, example: AGENT_PROGRAMME_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  programme(@CurrentActor() actor: Actor): Promise<AgentProgrammeDto> {
    return this.agents.programme(customer(actor).userId);
  }

  @Get('application')
  @ApiEndpoint({
    id: 'store.agent.getApplication',
    summary: 'Get my latest agent application',
    description:
      'With its status and, when rejected, the reason (D-416). The account number shows its last 4 digits.',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Application', type: AgentApplicationDto, example: APPLICATION_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async application(@CurrentActor() actor: Actor): Promise<AgentApplicationDto> {
    return applicationDto(await this.agents.myApplication(customer(actor).userId));
  }

  @Post('application')
  @ApiEndpoint({
    id: 'store.agent.apply',
    summary: 'Apply to become a sales agent',
    description:
      'Legal name, Thai tax id, address, an identity document and a bank account (uploaded files of mine), ' +
      'and acceptance of the agent agreement version in force — recorded with its evidence (D-416). One open ' +
      'application at a time; Sales decides.',
    implements: DECISIONS,
  })
  @ApiBody({
    type: SubmitAgentApplicationDto,
    examples: {
      default: {
        value: {
          juristicType: 'individual',
          legalName: 'สมชาย ขายเก่ง',
          taxId: '0000000000127',
          address: '99/1 ถนนพระราม 9 แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพฯ',
          postcode: '10310',
          idDocumentFileId: AGENT_IDS.file,
          bankCode: '014',
          bankAccountName: 'สมชาย ขายเก่ง',
          bankAccountNo: '1234567890',
          agreementVersionNo: 1,
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Application submitted',
    type: AgentApplicationDto,
    example: APPLICATION_EXAMPLE,
  })
  @ApiStandardErrors(
    ...WRITE,
    'agents.already_agent',
    'agents.application_open',
    'agents.agreement_missing',
    'agents.agreement_outdated',
  )
  async apply(@CurrentActor() actor: Actor, @Body() body: SubmitAgentApplicationDto, @Req() req: Request) {
    return applicationDto(
      await this.agents.submit(customer(actor), body, {
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      }),
    );
  }

  @Post('application/actions/withdraw')
  @HttpCode(200)
  @ApiEndpoint({
    id: 'store.agent.withdrawApplication',
    summary: 'Withdraw my open application',
    description: 'Before Sales decides (D-416).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Withdrawn',
    type: AgentApplicationDto,
    example: { ...APPLICATION_EXAMPLE, status: 'withdrawn' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async withdraw(@CurrentActor() actor: Actor): Promise<AgentApplicationDto> {
    return applicationDto(await this.agents.withdraw(customer(actor)));
  }

  @Post('claims')
  @HttpCode(200)
  @ApiEndpoint({
    id: 'store.agent.claimLink',
    summary: 'Claim an agent link after sign-in',
    description:
      'The web calls this once a customer who arrived through `/a/{code}` is signed in (D-417). A new ' +
      'customer is linked to the agent; otherwise `linked` is false with the reason (already linked, not a ' +
      'new customer, own code, agent not active). An unknown code is `agents.code_invalid`.',
    implements: DECISIONS,
  })
  @ApiBody({ type: AttributeReferralDto, examples: { default: { value: { code: 'K7QX2MAP' } } } })
  @ApiSuccess(200, {
    description: 'Outcome',
    type: ClaimedAgentLinkDto,
    example: { linked: true, reason: null },
  })
  @ApiStandardErrors(...WRITE, 'agents.code_invalid')
  claim(@CurrentActor() actor: Actor, @Body() body: AttributeReferralDto): Promise<ClaimedAgentLinkDto> {
    return this.attribution.claim(customer(actor), body.code);
  }

  // --- the agent's own pages (agent.self) ----------------------------------------------------------------

  @Get()
  @Can('agent.self')
  @ApiEndpoint({
    id: 'store.agent.me',
    summary: 'Get my agent profile',
    description: 'My code and link, plan terms in force and totals by commission status (D-416, D-418).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Agent', type: AgentDto, example: AGENT_EXAMPLE })
  @ApiStandardErrors('validation.failed', 'agents.not_agent')
  async me(@CurrentActor() actor: Actor): Promise<AgentDto> {
    const row = await this.agents.mine(customer(actor).userId);
    return agentDto(
      row,
      this.agents.linkFor(row.code),
      await this.agents.termsNow(row.planId),
      await this.agents.totals(row.id),
    );
  }

  @Get('customers')
  @Can('agent.self')
  @ApiEndpoint({
    id: 'store.agent.customers',
    summary: 'List my customers',
    description:
      'Customers and companies linked to me, newest first, with orders commissioned and commission. A person ' +
      'who came through my link shows by first letter only (D-422).',
    implements: DECISIONS,
  })
  @ApiPaginated(AgentLinkDto, { example: AGENT_LINK_EXAMPLE })
  @ApiStandardErrors('validation.failed', 'agents.not_agent')
  async customers(@CurrentActor() actor: Actor, @Query() q: MyLinkListQuery) {
    const agent = await this.agents.mine(customer(actor).userId);
    const [rows, total] = await this.attribution.links(
      { agentId: agent.id, ...(q.status && { status: q.status }) },
      q.page,
      q.perPage,
    );
    return {
      data: rows.map((r) => agentLinkDto(r, true)),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Get('leads')
  @Can('agent.self')
  @ApiEndpoint({
    id: 'store.agent.leads',
    summary: 'List my leads',
    description: 'Customer and factory prospects I registered, with their protection (D-417, D-419).',
    implements: DECISIONS,
  })
  @ApiPaginated(AgentLeadDto, { example: LEAD_EXAMPLE })
  @ApiStandardErrors('validation.failed', 'agents.not_agent')
  async leads(@CurrentActor() actor: Actor, @Query() q: MyLeadListQuery) {
    const agent = await this.agents.mine(customer(actor).userId);
    const [rows, total] = await this.attribution.leads(
      { agentId: agent.id, ...(q.status && { status: q.status }) },
      q.page,
      q.perPage,
    );
    return { data: rows.map(leadDto), meta: { page: q.page, perPage: q.perPage, total } };
  }

  @Post('leads')
  @Can('agent.self')
  @ApiEndpoint({
    id: 'store.agent.registerLead',
    summary: 'Register a lead',
    description:
      'A customer or factory prospect with a phone, e-mail or tax id, who agreed to be contacted (PDPA). ' +
      'Protected for `agents.rules.leadProtectionDays`; refused when it is already a customer, company or ' +
      'factory, or another agent’s protected lead (D-417, D-419).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: RegisterAgentLeadDto,
    examples: {
      default: {
        value: {
          kind: 'customer',
          contactName: 'คุณมานี ใจดี',
          organisationName: 'ร้านกาแฟบ้านสวน',
          phone: '+66890001234',
          consentConfirmed: true,
        },
      },
    },
  })
  @ApiSuccess(201, { description: 'Lead', type: AgentLeadDto, example: LEAD_EXAMPLE })
  @ApiStandardErrors(
    ...WRITE,
    'agents.not_agent',
    'agents.agent_inactive',
    'agents.too_many_leads',
    'agents.lead_existing_customer',
    'agents.lead_existing_factory',
    'agents.lead_taken',
    'agents.lead_duplicate',
  )
  async registerLead(
    @CurrentActor() actor: Actor,
    @Body() body: RegisterAgentLeadDto,
  ): Promise<AgentLeadDto> {
    const me = customer(actor);
    return leadDto(await this.attribution.registerLead(me, await this.agents.mine(me.userId), body));
  }

  @Post('leads/:leadId/actions/withdraw')
  @HttpCode(200)
  @Can('agent.self')
  @ApiParam({ name: 'leadId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.agent.withdrawLead',
    summary: 'Withdraw a lead',
    description: 'The contact is free for anyone again (D-417).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Lead',
    type: AgentLeadDto,
    example: { ...LEAD_EXAMPLE, status: 'withdrawn' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'agents.not_agent', 'agents.lead_closed')
  async withdrawLead(
    @CurrentActor() actor: Actor,
    @Param('leadId', ParseUUIDPipe) leadId: string,
  ): Promise<AgentLeadDto> {
    const me = customer(actor);
    return leadDto(await this.attribution.withdrawLead(me, await this.agents.mine(me.userId), leadId));
  }

  @Get('commissions')
  @Can('agent.self')
  @ApiEndpoint({
    id: 'store.agent.commissions',
    summary: 'List my commission',
    description:
      'Every entry, newest first: completed orders (pending until the claim window and payment), bounties, ' +
      'adjustments and refund reversals (D-418, D-419).',
    implements: DECISIONS,
  })
  @ApiPaginated(AgentCommissionDto, { example: COMMISSION_EXAMPLE })
  @ApiStandardErrors('validation.failed', 'agents.not_agent')
  async myCommissions(@CurrentActor() actor: Actor, @Query() q: MyCommissionListQuery) {
    const agent = await this.agents.mine(customer(actor).userId);
    const [rows, total] = await this.commissions.list(
      { agentId: agent.id, ...(q.status && { status: q.status }) },
      q.page,
      q.perPage,
    );
    return {
      data: rows.map((r) => commissionDto(r, true)),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Get('statements')
  @Can('agent.self')
  @ApiEndpoint({
    id: 'store.agent.statements',
    summary: 'List my statements',
    description:
      'Monthly statements, newest first, with withholding and the amount transferred once paid (D-420).',
    implements: DECISIONS,
  })
  @ApiPaginated(AgentStatementDto, { example: STATEMENT_EXAMPLE })
  @ApiStandardErrors('validation.failed', 'agents.not_agent')
  async myStatements(@CurrentActor() actor: Actor, @Query() q: PageQuery) {
    const agent = await this.agents.mine(customer(actor).userId);
    const [rows, total] = await this.statements.list(
      { agentId: agent.id, status: { not: 'voided' } },
      q.page,
      q.perPage,
    );
    return {
      data: rows.map((r) => statementDto(r, this.statements.payment(r))),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Get('statements/:statementId')
  @Can('agent.self')
  @ApiParam({ name: 'statementId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.agent.statement',
    summary: 'Get one of my statements',
    description: 'With its entries (D-420).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Statement',
    type: AgentStatementDetailDto,
    example: STATEMENT_DETAIL_EXAMPLE,
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'agents.not_agent')
  async myStatement(
    @CurrentActor() actor: Actor,
    @Param('statementId', ParseUUIDPipe) id: string,
  ): Promise<AgentStatementDetailDto> {
    const agent = await this.agents.mine(customer(actor).userId);
    const row = await this.statements.get(id);
    if (row.agentId !== agent.id || row.status === 'voided') throw new DomainException('http.not_found');
    return {
      ...statementDto(row, this.statements.payment(row)),
      entries: (await this.statements.entries(row.id)).map((e) => commissionDto(e, true)),
    };
  }

  @Get('statements/:statementId/wht-certificate')
  @Can('agent.self')
  @ApiParam({ name: 'statementId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.agent.whtCertificate',
    summary: 'Download the 50 ทวิ of a paid statement',
    description: 'A short-lived link to the withholding certificate issued when it was paid (D-421).',
    implements: [...DECISIONS, 'D-421'],
  })
  @ApiSuccess(200, {
    description: 'Download link',
    type: DownloadUrlDto,
    example: { url: 'https://getpack-files.s3.example.com/…', expiresAt: '2026-11-26T10:05:00+07:00' },
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'agents.not_agent')
  async certificate(
    @CurrentActor() actor: Actor,
    @Param('statementId', ParseUUIDPipe) id: string,
  ): Promise<DownloadUrlDto> {
    const agent = await this.agents.mine(customer(actor).userId);
    const row = await this.statements.get(id);
    if (row.agentId !== agent.id) throw new DomainException('http.not_found');
    return this.statements.certificateUrl(row);
  }
}
