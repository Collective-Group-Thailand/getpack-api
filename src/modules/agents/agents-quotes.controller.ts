import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { Idempotent } from '@common/idempotency/idempotent.decorator';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { toBangkokIso } from '@common/time/bangkok';
import { CONFIGURATION_EXAMPLE } from '@modules/pricing/quotes/quote.dto';
import { quoteDto } from '@modules/quotes/quote-views';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';

import { AgentDiscountsService, type DiscountRequestRow } from './agent-discounts.service';
import { type AgentQuoteRow, AgentQuotesService, agentQuoteStatus } from './agent-quotes.service';
import { AgentZoneGuard } from './agent-zone.guard';
import { AGENT_IDS } from './agents.dto';
import { AgentsService } from './agents.service';
import { P3_IDS } from './agents-pipeline.dto';
import {
  AGENT_QUOTE_EXAMPLE,
  AgentDiscountRequestDto,
  AgentQuoteDto,
  AgentQuoteListQuery,
  CompetitorSpecDto,
  CreateAgentQuoteDto,
  DEAL_EXAMPLE,
  DISCOUNT_OPTION_EXAMPLE,
  DISCOUNT_REQUEST_EXAMPLE,
  RequestAgentDiscountDto,
  WithdrawAgentQuoteDto,
} from './agents-quotes.dto';

const DECISIONS = ['D-441', 'D-051', 'D-468'];
const WRITE = ['http.bad_request', 'http.malformed_json', 'validation.failed'] as const;
const AGENT_ERRORS = ['agents.not_agent', 'agents.ended'] as const;

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

export function agentQuoteDto(
  service: AgentQuotesService,
  r: AgentQuoteRow,
  now = new Date(),
): AgentQuoteDto {
  const status = agentQuoteStatus(r, now);
  return {
    id: r.publicId,
    lead: { id: r.lead.publicId, contactName: r.lead.contactName, organisationName: r.lead.organisationName },
    status,
    shareUrl: status === 'sent' || status === 'opened' ? service.linkOf(r, now) : null,
    sentAt: toBangkokIso(r.sentAt),
    sendCount: r.sendCount,
    openedAt: r.openedAt ? toBangkokIso(r.openedAt) : null,
    acceptedAt: r.acceptedAt ? toBangkokIso(r.acceptedAt) : null,
    withdrawnAt: r.withdrawnAt ? toBangkokIso(r.withdrawnAt) : null,
    dealRegistration: r.dealRegistration
      ? {
          id: r.dealRegistration.publicId,
          status: r.dealRegistration.status,
          scope: r.dealRegistration.scope,
          origin: r.dealRegistration.origin,
          protectedUntil: toBangkokIso(r.dealRegistration.protectedUntil),
          lockedFirstRatePct: r.dealRegistration.lockedFirstRatePct.toFixed(4),
          lockedRepeatRatePct: r.dealRegistration.lockedRepeatRatePct.toFixed(4),
          registeredAt: toBangkokIso(r.dealRegistration.registeredAt),
        }
      : null,
    // The store's own customer view of the quotation: sell prices only, no cost, margin or factory (D-050, D-435).
    quote: quoteDto(r.quote, now),
  };
}

/**
 * D-468 item 2: quotes on behalf of getpack from the agent zone. The agent picks a product and configures it; the API
 * prices it on the one store path (D-441), saves it as getpack's quotation and returns the `/q/{token}` link that
 * carries the agent. No price or discount changes by the agent.
 */
@ApiSurface('store', 'agent')
@Controller('agent')
@UseGuards(AgentZoneGuard)
export class StoreAgentQuotesController {
  constructor(
    private readonly agents: AgentsService,
    private readonly quotes: AgentQuotesService,
    private readonly discounts: AgentDiscountsService,
  ) {}

  @Post('quotes')
  @Can('agent.self')
  @ApiEndpoint({
    id: 'store.agentQuotes.create',
    summary: 'Send a quotation to one of my leads',
    description:
      'Prices the configuration on the store path (store rules, default spec, instant products only — D-441), saves ' +
      'it as getpack’s quotation with its validity and shares it: `shareUrl` (`/q/{token}`) opens it for anyone ' +
      'with the link and carries my agent code. The lead moves to `quoted`; when the lead signs up with its phone or ' +
      'e-mail the quotation becomes theirs (D-417). I never change the price (D-468).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: CreateAgentQuoteDto,
    examples: {
      default: {
        value: {
          leadId: AGENT_IDS.lead,
          productTypeCode: 'folding_carton',
          configuration: CONFIGURATION_EXAMPLE,
          deliveryPostcode: '10110',
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Sent',
    type: AgentQuoteDto,
    example: { ...AGENT_QUOTE_EXAMPLE, status: 'sent', openedAt: null },
  })
  @ApiStandardErrors(
    ...WRITE,
    'http.not_found',
    ...AGENT_ERRORS,
    'agents.agent_inactive',
    'agents.lead_closed',
    'pricing.not_instant',
    'pricing.vat_rate_missing',
    'quotes.nothing_to_save',
    'numbering.series_missing',
  )
  async createQuote(@CurrentActor() actor: Actor, @Body() body: CreateAgentQuoteDto): Promise<AgentQuoteDto> {
    const me = customer(actor);
    const row = await this.quotes.create(me, await this.agents.mine(me.userId), body);
    return agentQuoteDto(this.quotes, row);
  }

  @Get('quotes')
  @Can('agent.self')
  @ApiEndpoint({
    id: 'store.agentQuotes.list',
    summary: 'List the quotations I sent',
    description:
      'Newest first, with status and when they were opened or accepted; by lead or status (D-468).',
    implements: DECISIONS,
  })
  @ApiPaginated(AgentQuoteDto, { example: AGENT_QUOTE_EXAMPLE })
  @ApiStandardErrors('validation.failed', ...AGENT_ERRORS)
  async listQuotes(@CurrentActor() actor: Actor, @Query() q: AgentQuoteListQuery) {
    const agent = await this.agents.mine(customer(actor).userId);
    const [rows, total] = await this.quotes.list(
      agent,
      { ...(q.leadId && { leadId: q.leadId }), ...(q.status && { status: q.status }) },
      q.page,
      q.perPage,
    );
    const now = new Date();
    return {
      data: rows.map((r) => agentQuoteDto(this.quotes, r, now)),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Get('quotes/:agentQuoteId')
  @Can('agent.self')
  @ApiParam({ name: 'agentQuoteId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.agentQuotes.get',
    summary: 'Get a quotation I sent',
    description: 'The quotation as the customer sees it, its link and status (D-468).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Quotation', type: AgentQuoteDto, example: AGENT_QUOTE_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed', ...AGENT_ERRORS)
  async getQuote(
    @CurrentActor() actor: Actor,
    @Param('agentQuoteId', ParseUUIDPipe) id: string,
  ): Promise<AgentQuoteDto> {
    const agent = await this.agents.mine(customer(actor).userId);
    return agentQuoteDto(this.quotes, await this.quotes.get(agent, id));
  }

  @Post('quotes/:agentQuoteId/actions/resend')
  @HttpCode(200)
  @Can('agent.self')
  @ApiParam({ name: 'agentQuoteId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.agentQuotes.resend',
    summary: 'Get a new link for a quotation I sent',
    description:
      'A new `/q/{token}` link (the previous one stops working) for a quotation still valid; written to the ' +
      'lead’s timeline (D-468).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Quotation',
    type: AgentQuoteDto,
    example: { ...AGENT_QUOTE_EXAMPLE, sendCount: 2 },
  })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    ...AGENT_ERRORS,
    'agents.quote_closed',
    'quotes.not_live',
  )
  async resendQuote(
    @CurrentActor() actor: Actor,
    @Param('agentQuoteId', ParseUUIDPipe) id: string,
  ): Promise<AgentQuoteDto> {
    const me = customer(actor);
    return agentQuoteDto(this.quotes, await this.quotes.resend(me, await this.agents.mine(me.userId), id));
  }

  @Post('quotes/:agentQuoteId/actions/withdraw')
  @HttpCode(200)
  @Can('agent.self')
  @ApiParam({ name: 'agentQuoteId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.agentQuotes.withdraw',
    summary: 'Withdraw a quotation I sent',
    description: 'The link stops working at once; written to the lead’s timeline (D-468).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: WithdrawAgentQuoteDto,
    examples: { default: { value: { reason: 'ลูกค้าขอเปลี่ยนขนาด จะส่งใบใหม่' } } },
  })
  @ApiSuccess(200, {
    description: 'Quotation',
    type: AgentQuoteDto,
    example: {
      ...AGENT_QUOTE_EXAMPLE,
      status: 'withdrawn',
      shareUrl: null,
      withdrawnAt: '2026-10-19T09:00:00+07:00',
    },
  })
  @ApiStandardErrors(...WRITE, 'http.not_found', ...AGENT_ERRORS, 'agents.quote_closed')
  async withdrawQuote(
    @CurrentActor() actor: Actor,
    @Param('agentQuoteId', ParseUUIDPipe) id: string,
    @Body() body: WithdrawAgentQuoteDto,
  ): Promise<AgentQuoteDto> {
    const me = customer(actor);
    return agentQuoteDto(
      this.quotes,
      await this.quotes.withdraw(me, await this.agents.mine(me.userId), id, body.reason),
    );
  }

  @Post('quotes/:agentQuoteId/actions/register-deal')
  @HttpCode(200)
  @Can('agent.self')
  @ApiParam({ name: 'agentQuoteId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.agentQuotes.registerDeal',
    summary: 'Register the deal of a quotation I sent',
    description:
      'Protection + rate lock, never a rate cut, no approval: for `agent.deal_protection_days` (90) nobody else can ' +
      'take this lead or its customer, and orders from its quotations keep the rates in force now (or the option I ' +
      'accepted); later plan changes never touch it. Quotations whose base reaches ' +
      '`agent.deal_registration_threshold` (฿500,000.00) and call-off agreements register automatically. A ' +
      'quotation of a lead with a registration joins it (D-468, PLAN A-11).',
    implements: [...DECISIONS, 'D-464'],
  })
  @ApiSuccess(200, {
    description: 'Registered',
    type: AgentQuoteDto,
    example: { ...AGENT_QUOTE_EXAMPLE, dealRegistration: { ...DEAL_EXAMPLE, origin: 'requested' } },
  })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    ...AGENT_ERRORS,
    'agents.agent_inactive',
    'agents.quote_closed',
    'agents.plan_not_in_force',
  )
  async registerDeal(
    @CurrentActor() actor: Actor,
    @Param('agentQuoteId', ParseUUIDPipe) id: string,
  ): Promise<AgentQuoteDto> {
    const me = customer(actor);
    return agentQuoteDto(
      this.quotes,
      await this.quotes.registerDeal(me, await this.agents.mine(me.userId), id),
    );
  }

  // --- discount requests (D-468 item 3) -------------------------------------------------------------------------

  @Post('quotes/:agentQuoteId/discount-requests')
  @Can('agent.self')
  @ApiParam({ name: 'agentQuoteId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.agentQuotes.requestDiscount',
    summary: 'Ask getpack for a better price on a quotation I sent',
    description:
      'Give-get first: what the customer gives in return (more quantity, a call-off of N months, a deposit or cash ' +
      'within N days, a longer lead time, a spec change — at least one), then the reason and, for a competitor’s ' +
      'price, their quotation (file) and a like-for-like spec. One open request per quotation; another round only ' +
      'when the give-get changed (`quotes.discount_round_limit`). Every round is kept. getpack answers with 1–3 ' +
      'options; the first always keeps my full rate (D-468, PLAN A-10).',
    implements: [...DECISIONS, 'D-464'],
  })
  @ApiBody({
    type: RequestAgentDiscountDto,
    examples: {
      default: {
        value: {
          requestedPct: '6.00',
          reason: 'competitor_price',
          quantityChange: 8000,
          depositPct: '50.00',
          competitorFileId: P3_IDS.file,
          competitorSpec: { boardGrade: 'KA125/CA125', flute: 'B', quantity: 5000, vatIncluded: true },
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Requested',
    type: AgentDiscountRequestDto,
    example: { ...DISCOUNT_REQUEST_EXAMPLE, status: 'open', decidedAt: null, options: [] },
  })
  @ApiStandardErrors(
    ...WRITE,
    'http.not_found',
    ...AGENT_ERRORS,
    'agents.agent_inactive',
    'agents.quote_closed',
    'quotes.discount_request_open',
    'quotes.discount_round_limit',
  )
  async requestDiscount(
    @CurrentActor() actor: Actor,
    @Param('agentQuoteId', ParseUUIDPipe) id: string,
    @Body() body: RequestAgentDiscountDto,
  ): Promise<AgentDiscountRequestDto> {
    const me = customer(actor);
    const row = await this.discounts.request(me, await this.agents.mine(me.userId), id, {
      ...body,
      competitorSpec: body.competitorSpec ? { ...body.competitorSpec } : null,
    });
    return discountRequestDto(row);
  }

  @Get('quotes/:agentQuoteId/discount-requests')
  @Can('agent.self')
  @ApiParam({ name: 'agentQuoteId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.agentQuotes.discountRequests',
    summary: 'Read my discount requests on a quotation',
    description:
      'Every round, oldest first, with the options offered: the customer’s discount, the price and my commission ' +
      'at that price (computed by getpack). Never cost or margin (D-468, D-464).',
    implements: [...DECISIONS, 'D-464'],
  })
  @ApiSuccess(200, {
    description: 'Rounds',
    type: [AgentDiscountRequestDto],
    example: [DISCOUNT_REQUEST_EXAMPLE],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed', ...AGENT_ERRORS)
  async discountRequests(
    @CurrentActor() actor: Actor,
    @Param('agentQuoteId', ParseUUIDPipe) id: string,
  ): Promise<AgentDiscountRequestDto[]> {
    const agent = await this.agents.mine(customer(actor).userId);
    return (await this.discounts.requests(agent, id)).map(discountRequestDto);
  }

  @Post('quotes/:agentQuoteId/discount-options/:optionId/actions/accept')
  @HttpCode(200)
  @Can('agent.self')
  @Idempotent()
  @ApiParam({ name: 'agentQuoteId', format: 'uuid' })
  @ApiParam({ name: 'optionId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.agentQuotes.acceptOption',
    summary: 'Accept one of the options offered',
    description:
      'My own choice, recorded with its evidence (time, ip, browser, the option as shown and its SHA-256): a ' +
      'co-fund option lowers my rate on orders from this quotation only because I accept it; a spiff raises it. ' +
      'The other options lapse. Within the option’s validity (`quotes.discounted_validity_days`, D-468, D-464).',
    implements: [...DECISIONS, 'D-464'],
  })
  @ApiSuccess(200, {
    description: 'Accepted',
    type: AgentDiscountRequestDto,
    example: {
      ...DISCOUNT_REQUEST_EXAMPLE,
      status: 'accepted',
      options: [{ ...DISCOUNT_OPTION_EXAMPLE, status: 'accepted', acceptedAt: '2026-10-19T09:00:00+07:00' }],
    },
  })
  @ApiStandardErrors(
    'http.not_found',
    'validation.failed',
    ...AGENT_ERRORS,
    'agents.discount_option_unavailable',
  )
  async acceptOption(
    @CurrentActor() actor: Actor,
    @Param('agentQuoteId', ParseUUIDPipe) id: string,
    @Param('optionId', ParseUUIDPipe) optionId: string,
  ): Promise<AgentDiscountRequestDto> {
    const me = customer(actor);
    return discountRequestDto(
      await this.discounts.acceptOption(me, await this.agents.mine(me.userId), id, optionId),
    );
  }
}

export function discountRequestDto(r: DiscountRequestRow): AgentDiscountRequestDto {
  const iso = (d: Date | null) => (d ? toBangkokIso(d) : null);
  return {
    id: r.publicId,
    round: r.round,
    status: r.status,
    quoteOptionId: r.quoteOption.publicId,
    quantity: r.quoteOption.quantity,
    requestedPct: r.requestedPct.toFixed(4),
    reason: r.reason,
    reasonNote: r.reasonNote,
    quantityChange: r.quantityChange,
    commitment: r.commitment,
    commitmentMonths: r.commitmentMonths,
    depositPct: r.depositPct?.toFixed(4) ?? null,
    cashWithinDays: r.cashWithinDays,
    leadTimeFlexDays: r.leadTimeFlexDays,
    specChange: r.specChange,
    competitorFile: r.competitorFile
      ? { id: r.competitorFile.publicId, fileName: r.competitorFile.originalName }
      : null,
    competitorSpec: (r.competitorSpec as CompetitorSpecDto | null) ?? null,
    decisionNote: r.decisionNote,
    createdAt: toBangkokIso(r.createdAt),
    decidedAt: iso(r.decidedAt),
    options: r.options.map((o) => ({
      id: o.publicId,
      position: o.position,
      kind: o.kind,
      status: o.status,
      discountPct: o.discountPct.toFixed(4),
      netAmount: o.netAmount.toFixed(2),
      ratePct: o.ratePct.toFixed(4),
      standardRatePct: o.standardRatePct.toFixed(4),
      commissionAmount: o.commissionAmount.toFixed(2),
      conditionsTh: o.conditionsTh,
      conditionsEn: o.conditionsEn,
      validUntil: toBangkokIso(o.validUntil),
      acceptedAt: iso(o.acceptedAt),
    })),
  };
}
