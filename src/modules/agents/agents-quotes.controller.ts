import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
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

import { type AgentQuoteRow, AgentQuotesService, agentQuoteStatus } from './agent-quotes.service';
import { AgentZoneGuard } from './agent-zone.guard';
import { AGENT_IDS } from './agents.dto';
import { AgentsService } from './agents.service';
import {
  AGENT_QUOTE_EXAMPLE,
  AgentQuoteDto,
  AgentQuoteListQuery,
  CreateAgentQuoteDto,
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
}
