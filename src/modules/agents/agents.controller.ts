import { CurrentActor, Public } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { IfMatch } from '@common/etag/etag.interceptor';
import {
  ApiConcurrency,
  ApiEndpoint,
  ApiEtag,
  ApiStandardErrors,
  ApiSuccess,
} from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { PageQuery } from '@common/pagination/pagination.dto';
import { toBangkokIso } from '@common/time/bangkok';
import { OtpChallengeDto, OtpVerifyDto } from '@modules/auth/auth.dto';
import { toE164 } from '@modules/auth/login/phone';
import { AttributeReferralDto } from '@modules/promotions/referrals.dto';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { DownloadUrlDto } from '@platform/files/files.dto';
import { type Request, type Response } from 'express';

import { AgentAttributionService } from './agent-attribution.service';
import { AgentCommissionsService } from './agent-commissions.service';
import { AgentPayoutProfilesService, payoutProfileEtag } from './agent-payout-profiles.service';
import { AgentRateLimiter } from './agent-rate-limit';
import { invalid } from './agent-shared';
import { AgentStatementsService } from './agent-statements.service';
import { AgentTaxDeclarationsService } from './agent-tax-declarations.service';
import { AgentWaitlistService } from './agent-waitlist.service';
import { AgentAccess, AgentZoneGuard } from './agent-zone.guard';
import {
  AGENT_EXAMPLE,
  AGENT_IDS,
  AGENT_LINK_EXAMPLE,
  AGENT_PROGRAMME_EXAMPLE,
  AgentApplicationDto,
  AgentCommissionDto,
  AgentCommissionExampleDto,
  AgentCommissionExampleQuery,
  AgentDto,
  AgentLeadDto,
  AgentLinkDto,
  AgentPayoutProfileDto,
  AgentPhoneOtpRequestDto,
  AgentPhoneVerifiedDto,
  AgentProgrammeDto,
  AgentStatementDetailDto,
  AgentStatementDto,
  AgentTaxDeclarationDto,
  APPLICATION_EXAMPLE,
  ClaimedAgentLinkDto,
  COMMISSION_EXAMPLE,
  LEAD_EXAMPLE,
  MY_PAYOUT_PROFILE_EXAMPLE,
  MY_TAX_DECLARATION_EXAMPLE,
  MyCommissionListQuery,
  MyLeadListQuery,
  MyLinkListQuery,
  MyPayoutProfileDto,
  MyTaxDeclarationDto,
  PAYOUT_PROFILE_EXAMPLE,
  PUBLIC_PROGRAMME_EXAMPLE,
  PublicAgentProgrammeDto,
  RegisterAgentLeadDto,
  STATEMENT_DETAIL_EXAMPLE,
  STATEMENT_EXAMPLE,
  SubmitAgentApplicationDto,
  SubmitAgentTaxDeclarationDto,
  TAX_DECLARATION_EXAMPLE,
  UpsertAgentPayoutProfileDto,
} from './agents.dto';
import { AgentsService } from './agents.service';
import {
  agentDto,
  agentLinkDto,
  applicationDto,
  commissionDto,
  leadDto,
  payoutProfileDto,
  statementDto,
  taxDeclarationDto,
} from './agents-views';
import { AgentWaitlistReceiptDto, JoinAgentWaitlistDto } from './agents-waitlist.dto';

const DECISIONS = ['D-416', 'D-417', 'D-418', 'D-420', 'D-422', 'D-464'];
/** P7: technical limit of the anonymous waiting-list form, per IP (on top of the global throttle). */
export const WAITLIST_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
const WRITE = ['http.bad_request', 'http.malformed_json', 'validation.failed'] as const;

const AGENT_OTP_EXAMPLE: OtpChallengeDto = {
  challengeId: '0192f3a0-7c1e-7d2a-9b1f-00000000c0de',
  expiresAt: '2026-11-03T14:10:00+07:00',
  resendAvailableAt: '2026-11-03T14:06:00+07:00',
  codeLength: 6,
  maxAttempts: 5,
};

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

/**
 * The agent pages of the storefront (D-416 – D-422): any signed-in customer reads the programme, applies
 * and claims an agent link; an approved agent (`agent.self`) works their link, leads, customers,
 * commission and statements. An agent sees only their own rows; customers who came through the link show
 * masked (D-422). D-467: `AgentZoneGuard` checks every handler — `@AgentAccess('anyone')` before becoming an
 * agent, otherwise an active or suspended agent; an ended agent keeps the statements and 50 ทวิ (`records`).
 */
@ApiSurface('store', 'agent')
@Controller('agent')
@UseGuards(AgentZoneGuard)
export class StoreAgentController {
  constructor(
    private readonly agents: AgentsService,
    private readonly attribution: AgentAttributionService,
    private readonly commissions: AgentCommissionsService,
    private readonly statements: AgentStatementsService,
    private readonly declarations: AgentTaxDeclarationsService,
    private readonly payoutProfiles: AgentPayoutProfilesService,
    private readonly limits: AgentRateLimiter,
    private readonly waitlist: AgentWaitlistService,
  ) {}

  @Get('programme')
  @AgentAccess('anyone')
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
    return this.agents.programme(customer(actor));
  }

  @Get('application')
  @AgentAccess('anyone')
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
  @AgentAccess('anyone')
  @ApiEndpoint({
    id: 'store.agent.apply',
    summary: 'Apply to become a sales agent (step 1)',
    description:
      'Step 1 of joining (D-466): name, the account’s verified phone (else `agents.phone_unverified` — the web runs ' +
      'OTP), e-mail, LINE id, how I sell and acceptance of the agent agreement version in force — recorded with its ' +
      'evidence (D-416). Tax id, address, identity document and bank come in the payout profile, before the first ' +
      'payout. Closed while the feature flag `agents.programme` is off (`agents.programme_closed`). One open ' +
      'application at a time; Sales decides.',
    implements: [...DECISIONS, 'D-466'],
  })
  @ApiBody({
    type: SubmitAgentApplicationDto,
    examples: {
      default: {
        value: {
          juristicType: 'individual',
          displayName: 'สมชาย ขายเก่ง',
          phone: '+66810005678',
          email: 'somchai@example.invalid',
          lineId: 'somchai.sales',
          salesChannels: ['line_groups', 'own_network'],
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
    'agents.programme_closed',
    'agents.phone_unverified',
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
  @AgentAccess('anyone')
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
  @AgentAccess('anyone')
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
  @ApiStandardErrors('validation.failed', 'agents.not_agent', 'agents.ended')
  async me(@CurrentActor() actor: Actor): Promise<AgentDto> {
    const row = await this.agents.mine(customer(actor).userId);
    return agentDto(
      row,
      this.agents.linkFor(row.code),
      await this.agents.storeTermsNow(row.planId),
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
  @ApiStandardErrors('validation.failed', 'agents.not_agent', 'agents.ended')
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
    description: 'Customer prospects I registered, with their protection (D-417, D-464).',
    implements: DECISIONS,
  })
  @ApiPaginated(AgentLeadDto, { example: LEAD_EXAMPLE })
  @ApiStandardErrors('validation.failed', 'agents.not_agent', 'agents.ended')
  async leads(@CurrentActor() actor: Actor, @Query() q: MyLeadListQuery) {
    const agent = await this.agents.mine(customer(actor).userId);
    const [rows, total] = await this.attribution.leads(
      // P-03 / D-464: factory leads are history, kept for staff only.
      { agentId: agent.id, kind: 'customer', ...(q.status && { status: q.status }) },
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
      'A customer prospect with a phone, e-mail or tax id, who agreed to be contacted (PDPA). Protected for ' +
      '`agents.rules.leadProtectionDays`; refused with the one neutral `agents.lead_unavailable` when it is already ' +
      'a customer or company, another agent’s protected lead or registered deal (D-417, D-440, D-468), ' +
      '`agents.lead_duplicate` when it is already mine. Kind `customer` only — anything else is ' +
      '`agents.lead_kind_unsupported` (P-03, D-464): factories apply at /partner-with-us. D-468: optional pipeline ' +
      'fields (source manual | card_scan, expected value, next follow-up, industry, LINE id, tags); the lead starts ' +
      'at stage `new`.',
    implements: [...DECISIONS, 'D-440', 'D-468'],
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
    'agents.ended',
    'agents.agent_inactive',
    'agents.lead_kind_unsupported',
    'agents.too_many_leads',
    'agents.lead_unavailable',
    'agents.lead_duplicate',
    'agents.rate_limited',
  )
  async registerLead(
    @CurrentActor() actor: Actor,
    @Body() body: RegisterAgentLeadDto,
  ): Promise<AgentLeadDto> {
    const me = customer(actor);
    const agent = await this.agents.mine(me.userId);
    // Same budget as the duplicate check: a refused registration answers the same neutral reason (P7 review).
    await this.limits.hit(agent.id, 'lead_check');
    return leadDto(await this.attribution.registerLead(me, agent, body));
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
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    'agents.not_agent',
    'agents.ended',
    'agents.lead_closed',
  )
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
      'Every entry, newest first: completed orders at the full rate with no cap (pending until the claim ' +
      'window and payment), adjustments and refund reversals (D-418, D-464).',
    implements: DECISIONS,
  })
  @ApiPaginated(AgentCommissionDto, { example: COMMISSION_EXAMPLE })
  @ApiStandardErrors('validation.failed', 'agents.not_agent', 'agents.ended')
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
  @AgentAccess('records')
  @Can('agent.self')
  @ApiEndpoint({
    id: 'store.agent.statements',
    summary: 'List my statements',
    description:
      'Monthly statements, newest first, with withholding and the amount transferred once paid (D-420).',
    implements: DECISIONS,
  })
  @ApiPaginated(AgentStatementDto, { example: STATEMENT_EXAMPLE })
  @ApiStandardErrors('validation.failed', 'agents.not_agent', 'agents.ended')
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
  @AgentAccess('records')
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
  @ApiStandardErrors('http.not_found', 'validation.failed', 'agents.not_agent', 'agents.ended')
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
  @AgentAccess('records')
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
  @ApiStandardErrors('http.not_found', 'validation.failed', 'agents.not_agent', 'agents.ended')
  async certificate(
    @CurrentActor() actor: Actor,
    @Param('statementId', ParseUUIDPipe) id: string,
  ): Promise<DownloadUrlDto> {
    const agent = await this.agents.mine(customer(actor).userId);
    const row = await this.statements.get(id);
    if (row.agentId !== agent.id) throw new DomainException('http.not_found');
    return this.statements.certificateUrl(row);
  }

  // --- ล.ย.01 (D-465) --------------------------------------------------------------------------------------

  @Get('tax-declaration')
  @Can('agent.self')
  @ApiEndpoint({
    id: 'store.agentTaxDeclaration.get',
    summary: 'Get my ล.ย.01 for this tax year',
    description:
      'Whether I need one (individual freelance agents), the personal allowance used without one, and my latest ' +
      'declaration of the current tax year with its status. Without an accepted ล.ย.01 only the personal ' +
      'allowance is used (D-465).',
    implements: ['D-465'],
  })
  @ApiSuccess(200, {
    description: 'Declaration',
    type: MyTaxDeclarationDto,
    example: MY_TAX_DECLARATION_EXAMPLE,
  })
  @ApiStandardErrors('validation.failed', 'agents.not_agent', 'agents.ended')
  async taxDeclaration(@CurrentActor() actor: Actor): Promise<MyTaxDeclarationDto> {
    const agent = await this.agents.mine(customer(actor).userId);
    const taxYear = this.declarations.currentTaxYear();
    const latest = await this.declarations.latest(agent.id, taxYear);
    return {
      taxYear,
      applicable: agent.kind === 'freelance' && agent.juristicType === 'individual',
      personalAllowance: await this.agents.personalAllowance(),
      declaration: latest ? taxDeclarationDto(latest) : null,
    };
  }

  @Post('tax-declaration')
  @Can('agent.self')
  @ApiEndpoint({
    id: 'store.agentTaxDeclaration.submit',
    summary: 'Submit my ล.ย.01 for this tax year',
    description:
      'Allowance amounts by group (family, insurance and savings, housing, donations) with my uploaded evidence. ' +
      'One waiting declaration at a time; Finance accepts or rejects it. A later accepted one replaces an earlier ' +
      'one for the next statements (D-465).',
    implements: ['D-465'],
  })
  @ApiBody({
    type: SubmitAgentTaxDeclarationDto,
    examples: {
      default: {
        value: {
          allowances: { spouse: '60000.00', lifeInsurance: '30000.00' },
          evidenceFileIds: [AGENT_IDS.file],
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Declaration',
    type: AgentTaxDeclarationDto,
    example: TAX_DECLARATION_EXAMPLE,
  })
  @ApiStandardErrors(
    ...WRITE,
    'agents.not_agent',
    'agents.ended',
    'agents.tax_declaration_open',
    'agents.tax_declaration_not_applicable',
  )
  async submitTaxDeclaration(
    @CurrentActor() actor: Actor,
    @Body() body: SubmitAgentTaxDeclarationDto,
  ): Promise<AgentTaxDeclarationDto> {
    const me = customer(actor);
    const agent = await this.agents.mine(me.userId);
    return taxDeclarationDto(await this.declarations.submit(me, agent, body));
  }

  // --- D-466 public programme and payout profile -----------------------------------------------------------

  @Get('programme/public')
  @AgentAccess('anyone')
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  @ApiEtag()
  @ApiEndpoint({
    id: 'store.agentProgramme.public',
    summary: 'Read the agent programme (public landing)',
    description:
      'Anonymous, for getpack.co/agent: the standard freelance terms (no cap, D-464), link and lead protection days, ' +
      'payment terms, whether applying is open (feature flag `agents.programme`; else the landing offers a waiting ' +
      'list), the agreement in force, worked commission examples and the published FAQs of the CMS category ' +
      '`agent_programme`. Nothing about factories. Cacheable 5 minutes; a matching `If-None-Match` gets 304 (D-466).',
    implements: ['D-466', 'D-464'],
  })
  @ApiSuccess(200, {
    description: 'Programme',
    type: PublicAgentProgrammeDto,
    example: PUBLIC_PROGRAMME_EXAMPLE,
  })
  @ApiStandardErrors()
  publicProgramme(): Promise<PublicAgentProgrammeDto> {
    return this.agents.publicProgramme();
  }

  @Post('programme/waitlist')
  @HttpCode(200)
  @AgentAccess('anyone')
  @Public()
  @Throttle(WAITLIST_THROTTLE)
  @ApiEndpoint({
    id: 'store.agentProgramme.joinWaitlist',
    summary: 'Join the agent programme waiting list',
    description:
      'Anonymous, for getpack.co/agent while applying is closed (P7 pilot switch, D-466): a name, a phone or an ' +
      'e-mail (at least one), optionally how you sell, and acceptance of the waiting-list consent in force ' +
      '(`waitlistConsent.versionNo` of `store.agentProgramme.public`; recorded with its evidence). Always answers ' +
      '200 `received` — the same whether the contact was already listed (a repeat refreshes the row) — so it ' +
      'never tells who signed up. Throttled per IP (5 a minute). No consent text published → 409 ' +
      '`agents.waitlist_closed`; an older version → 409 `agents.waitlist_consent_outdated`. PDPA: kept until 12 ' +
      'months after the public opening or until the person asks.',
    implements: ['D-466', 'D-144', 'D-440'],
  })
  @ApiBody({
    type: JoinAgentWaitlistDto,
    examples: {
      default: {
        value: {
          name: 'สมชาย ขายเก่ง',
          phone: '0810005678',
          salesChannel: 'line_groups',
          consentVersionNo: 1,
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Received',
    type: AgentWaitlistReceiptDto,
    example: { status: 'received' },
  })
  @ApiStandardErrors(
    ...WRITE,
    'http.too_many_requests',
    'agents.waitlist_closed',
    'agents.waitlist_consent_outdated',
  )
  async joinWaitlist(
    @Body() body: JoinAgentWaitlistDto,
    @Req() req: Request,
  ): Promise<AgentWaitlistReceiptDto> {
    await this.waitlist.join(body, { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null });
    return { status: 'received' };
  }

  @Get('programme/example')
  @AgentAccess('anyone')
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  @ApiEndpoint({
    id: 'store.agentProgramme.example',
    summary: 'Work out the commission on an order value',
    description:
      'Anonymous, for the landing’s calculator: the commission at the standard freelance rates for an order value ' +
      'before VAT, excluding shipping, as a first and as a later order — the web does no money arithmetic (D-466).',
    implements: ['D-466', 'D-464'],
  })
  @ApiSuccess(200, {
    description: 'Example',
    type: AgentCommissionExampleDto,
    example: { orderValue: '250000.00', firstOrder: '12500.00', repeatOrder: '7500.00' },
  })
  @ApiStandardErrors('validation.failed', 'agents.plan_not_in_force')
  commissionExample(@Query() q: AgentCommissionExampleQuery): Promise<AgentCommissionExampleDto> {
    return this.agents.commissionExample(q.orderValue);
  }

  @Get('payout-profile')
  @Can('agent.self')
  @ApiEtag()
  @ApiEndpoint({
    id: 'store.agentPayoutProfile.get',
    summary: 'Get my payout profile',
    description:
      'Step 2 of joining (D-466): who I am paid as and where. Needed before the first payout, not before approval; ' +
      'statements wait as drafts until Finance verifies it. The account number shows its last 4 digits.',
    implements: ['D-466'],
  })
  @ApiSuccess(200, {
    description: 'Payout profile',
    type: MyPayoutProfileDto,
    example: MY_PAYOUT_PROFILE_EXAMPLE,
  })
  @ApiStandardErrors('validation.failed', 'agents.not_agent', 'agents.ended')
  async payoutProfile(
    @CurrentActor() actor: Actor,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MyPayoutProfileDto> {
    const agent = await this.agents.mine(customer(actor).userId);
    const row = await this.payoutProfiles.forAgent(agent.id);
    if (row) res.setHeader('ETag', payoutProfileEtag(row));
    return {
      applicable: agent.kind === 'freelance',
      payoutReady: await this.payoutProfiles.payoutReady(agent),
      juristicType: agent.juristicType,
      profile: row ? payoutProfileDto(row) : null,
    };
  }

  @Put('payout-profile')
  @Can('agent.self')
  @ApiConcurrency({ optional: true })
  @ApiEndpoint({
    id: 'store.agentPayoutProfile.upsert',
    summary: 'Save my payout profile (draft)',
    description:
      'Any subset of the fields; Thai tax id with its check digit; the bank account name must match the legal name ' +
      '(`agents.bank_name_mismatch`). A change after verification is a new draft to verify again. `If-Match` once ' +
      'a profile exists (D-466).',
    implements: ['D-466'],
  })
  @ApiBody({
    type: UpsertAgentPayoutProfileDto,
    examples: {
      default: {
        value: {
          legalName: 'สมชาย ขายเก่ง',
          taxId: '0000000000124',
          address: '99/1 ถนนพระราม 9 แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพฯ',
          postcode: '10310',
          bankCode: '014',
          bankAccountName: 'สมชาย ขายเก่ง',
          bankAccountNo: '1234567890',
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Payout profile',
    type: AgentPayoutProfileDto,
    example: { ...PAYOUT_PROFILE_EXAMPLE, status: 'draft' },
  })
  @ApiStandardErrors(
    ...WRITE,
    'agents.not_agent',
    'agents.ended',
    'agents.payout_profile_not_applicable',
    'agents.payout_profile_waiting',
    'agents.bank_name_mismatch',
  )
  async savePayoutProfile(
    @CurrentActor() actor: Actor,
    @Body() body: UpsertAgentPayoutProfileDto,
    @IfMatch() ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AgentPayoutProfileDto> {
    const me = customer(actor);
    const row = await this.payoutProfiles.upsert(me, await this.agents.mine(me.userId), body, ifMatch);
    res.setHeader('ETag', payoutProfileEtag(row));
    return payoutProfileDto(row);
  }

  @Post('payout-profile/actions/submit')
  @HttpCode(200)
  @Can('agent.self')
  @ApiConcurrency()
  @ApiEndpoint({
    id: 'store.agentPayoutProfile.submit',
    summary: 'Send my payout profile to Finance',
    description:
      'Every required field filled (else `validation.failed` naming them); Finance verifies (D-466).',
    implements: ['D-466'],
  })
  @ApiSuccess(200, {
    description: 'Payout profile',
    type: AgentPayoutProfileDto,
    example: PAYOUT_PROFILE_EXAMPLE,
  })
  @ApiStandardErrors(
    ...WRITE,
    'http.not_found',
    'agents.not_agent',
    'agents.ended',
    'agents.payout_profile_waiting',
    'agents.payout_profile_verified',
  )
  async submitPayoutProfile(
    @CurrentActor() actor: Actor,
    @IfMatch() ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AgentPayoutProfileDto> {
    const me = customer(actor);
    const row = await this.payoutProfiles.submit(me, await this.agents.mine(me.userId), ifMatch);
    res.setHeader('ETag', payoutProfileEtag(row));
    return payoutProfileDto(row);
  }

  @Post('phone-verification')
  @AgentAccess('anyone')
  @HttpCode(200)
  @ApiEndpoint({
    id: 'store.agentPhone.request',
    summary: 'Send an OTP to verify my phone before applying',
    description:
      'For a customer signed in with LINE, Google or Apple who has no verified phone yet (D-466): a code by SMS ' +
      '(purpose `verify_phone`), with the usual OTP limits.',
    implements: ['D-466'],
  })
  @ApiBody({ type: AgentPhoneOtpRequestDto, examples: { default: { value: { phone: '0810005678' } } } })
  @ApiSuccess(200, { description: 'Code sent', type: OtpChallengeDto, example: AGENT_OTP_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'auth.otp_rate_limited', 'provider.unavailable')
  async requestPhoneOtp(
    @CurrentActor() actor: Actor,
    @Body() body: AgentPhoneOtpRequestDto,
    @Req() req: Request,
  ) {
    customer(actor);
    const phone = toE164(body.phone);
    if (!phone) invalid('phone', 'a valid phone number', 'phone');
    const issued = await this.agents.requestPhoneOtp(phone, req.ip);
    return {
      challengeId: issued.challengeId,
      expiresAt: toBangkokIso(issued.expiresAt),
      resendAvailableAt: toBangkokIso(issued.resendAvailableAt),
      codeLength: issued.codeLength,
      maxAttempts: issued.maxAttempts,
    };
  }

  @Post('phone-verification/actions/confirm')
  @AgentAccess('anyone')
  @HttpCode(200)
  @ApiEndpoint({
    id: 'store.agentPhone.confirm',
    summary: 'Confirm the OTP: the phone becomes my verified phone',
    description:
      'The number becomes the account’s verified phone, unless another customer holds it (`agents.phone_in_use`, ' +
      'naming no one) (D-466).',
    implements: ['D-466'],
  })
  @ApiBody({
    type: OtpVerifyDto,
    examples: { default: { value: { challengeId: '0192f3a0-7c1e-7d2a-9b1f-00000000c0de', code: '123456' } } },
  })
  @ApiSuccess(200, {
    description: 'Verified',
    type: AgentPhoneVerifiedDto,
    example: { phone: '+66810005678' },
  })
  @ApiStandardErrors(...WRITE, 'auth.otp_invalid', 'auth.otp_expired', 'agents.phone_in_use')
  confirmPhone(@CurrentActor() actor: Actor, @Body() body: OtpVerifyDto): Promise<AgentPhoneVerifiedDto> {
    return this.agents.confirmPhone(customer(actor), body.challengeId, body.code);
  }
}
