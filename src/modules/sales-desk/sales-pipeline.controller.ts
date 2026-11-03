import { CurrentActor } from '@common/auth/auth.decorators';
import { Can, CanAny } from '@common/auth/can.decorator';
import { type Actor } from '@common/context/actor';
import { IfMatch } from '@common/etag/etag.interceptor';
import {
  ApiConcurrency,
  ApiEndpoint,
  ApiEtag,
  ApiStandardErrors,
  ApiSuccess,
} from '@common/openapi/decorators';
import { ApiCursorPaginated, ApiPaginated } from '@common/pagination/api-paginated.decorator';
import { CursorQuery } from '@common/pagination/pagination.dto';
import { AgentLeadsService, leadEtag } from '@modules/agents/agent-leads.service';
import { AgentQuotesService } from '@modules/agents/agent-quotes.service';
import { agentRef } from '@modules/agents/agent-shared';
import { ADMIN_LEAD_EXAMPLE, AdminAgentLeadDto, AGENT_IDS } from '@modules/agents/agents.dto';
import { activityDto } from '@modules/agents/agents-leads.controller';
import {
  ACTIVITY_EXAMPLE,
  AddAgentLeadActivityDto,
  AgentLeadActivityDto,
  ChangeAgentLeadStageDto,
  UpdateAgentLeadDto,
} from '@modules/agents/agents-pipeline.dto';
import { agentQuoteDto, discountRequestDto } from '@modules/agents/agents-quotes.controller';
import {
  AGENT_QUOTE_EXAMPLE,
  AgentDiscountRequestDto,
  AgentQuoteDto,
  CreateAgentQuoteDto,
  DISCOUNT_REQUEST_EXAMPLE,
  RequestAgentDiscountDto,
} from '@modules/agents/agents-quotes.dto';
import { adminLeadDto } from '@modules/agents/agents-views';
import { CONFIGURATION_EXAMPLE } from '@modules/pricing/quotes/quote.dto';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { type Response } from 'express';

import {
  CreateSalesLeadDto,
  SALES_REP_EXAMPLE,
  SalesLeadListQuery,
  SalesQuoteListQuery,
  SalesRepDto,
} from './sales-pipeline.dto';
import { SalesPipelineService } from './sales-pipeline.service';
import { SalesScopeService } from './sales-scope';

const DECISIONS = ['D-469', 'D-468', 'D-417', 'D-440', 'D-471'];
const WRITE = ['http.bad_request', 'http.malformed_json', 'validation.failed'] as const;
const SCOPE_ERRORS = ['sales.no_employee_agent'] as const;

/**
 * D-469 (PLAN A-07): company sales reps work their pipeline from the admin zone with their staff account — the same
 * lead model, stages, timeline, protection and neutral refusals as the agent zone (D-468). `sales.pipeline.self`
 * reaches the caller's own employee agent; `sales.pipeline.manage` every rep (acting for a rep is audited) and, read
 * only, freelance agents' leads.
 */
@ApiSurface('admin', 'salesLeads')
@Controller('sales/leads')
export class AdminSalesLeadsController {
  constructor(
    private readonly scopes: SalesScopeService,
    private readonly pipeline: SalesPipelineService,
    private readonly leads: AgentLeadsService,
  ) {}

  @Get()
  @CanAny('sales.pipeline.self', 'sales.pipeline.manage')
  @ApiEndpoint({
    id: 'admin.salesLeads.list',
    summary: 'List the sales pipeline',
    description:
      'A rep sees their own leads; a manager every rep’s (filter `agentId`) or, read-only, freelance agents’ ' +
      '(`agentKind=freelance`). Same views, filters, sort and cursor as the agent zone (D-469, D-468).',
    implements: DECISIONS,
  })
  @ApiCursorPaginated(AdminAgentLeadDto, { example: ADMIN_LEAD_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: SalesLeadListQuery) {
    const scope = await this.scopes.of(actor);
    const page = await this.pipeline.list(scope, q);
    return { data: page.data.map(adminLeadDto), meta: page.meta };
  }

  @Post()
  @CanAny('sales.pipeline.self', 'sales.pipeline.manage')
  @ApiEndpoint({
    id: 'admin.salesLeads.create',
    summary: 'Register a lead for a rep',
    description:
      'For my own employee agent, or (managers) a rep’s with `agentId`. The agent programme’s rules apply: ' +
      'consent, the open-leads limit, protection and one neutral refusal `agents.lead_unavailable` (an existing ' +
      'customer, another agent’s protected lead or registered deal — D-417, D-440). Starts at stage `new`.',
    implements: DECISIONS,
  })
  @ApiBody({
    type: CreateSalesLeadDto,
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
  @ApiSuccess(201, { description: 'Lead', type: AdminAgentLeadDto, example: ADMIN_LEAD_EXAMPLE })
  @ApiStandardErrors(
    ...WRITE,
    'http.not_found',
    ...SCOPE_ERRORS,
    'sales.lead_read_only',
    'agents.agent_inactive',
    'agents.lead_kind_unsupported',
    'agents.too_many_leads',
    'agents.lead_unavailable',
    'agents.lead_duplicate',
  )
  async create(@CurrentActor() actor: Actor, @Body() body: CreateSalesLeadDto): Promise<AdminAgentLeadDto> {
    return adminLeadDto(await this.pipeline.create(await this.scopes.of(actor), body));
  }

  @Get(':leadId')
  @CanAny('sales.pipeline.self', 'sales.pipeline.manage')
  @ApiEtag()
  @ApiParam({ name: 'leadId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.salesLeads.get',
    summary: 'Get a lead of the sales pipeline',
    description: 'With its pipeline fields, agent and protection; `ETag` for `update` (D-469).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, { description: 'Lead', type: AdminAgentLeadDto, example: ADMIN_LEAD_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async get(
    @CurrentActor() actor: Actor,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminAgentLeadDto> {
    const { lead } = await this.scopes.lead(await this.scopes.of(actor), leadId);
    res.setHeader('ETag', leadEtag(lead));
    return adminLeadDto(lead);
  }

  @Patch(':leadId')
  @CanAny('sales.pipeline.self', 'sales.pipeline.manage')
  @ApiConcurrency()
  @ApiParam({ name: 'leadId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.salesLeads.update',
    summary: 'Edit a lead of the sales pipeline',
    description:
      'Any subset of the fields (`If-Match` required); contact keys only while registered, through the same ' +
      'neutral check. Only company reps’ leads change here (`sales.lead_read_only`); a manager editing a rep’s ' +
      'lead is audited (D-469, D-468).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: UpdateAgentLeadDto,
    examples: {
      default: { value: { expectedValue: '60000.00', nextFollowUpAt: '2026-11-10T10:00:00+07:00' } },
    },
  })
  @ApiSuccess(200, { description: 'Lead', type: AdminAgentLeadDto, example: ADMIN_LEAD_EXAMPLE })
  @ApiStandardErrors(
    ...WRITE,
    'http.not_found',
    'sales.lead_read_only',
    'agents.lead_duplicate',
    'agents.lead_unavailable',
  )
  async update(
    @CurrentActor() actor: Actor,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() body: UpdateAgentLeadDto,
    @IfMatch() ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminAgentLeadDto> {
    const scope = await this.scopes.of(actor);
    const { agent } = await this.scopes.lead(scope, leadId, { write: true, action: 'update' });
    const row = await this.leads.update(scope.actor, agent, leadId, body, ifMatch);
    res.setHeader('ETag', leadEtag(row));
    return adminLeadDto(row);
  }

  @Post(':leadId/actions/change-stage')
  @HttpCode(200)
  @CanAny('sales.pipeline.self', 'sales.pipeline.manage')
  @ApiParam({ name: 'leadId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.salesLeads.changeStage',
    summary: 'Move a lead to another stage',
    description:
      'new, contacted, quoted, negotiating or lost (with a reason); `won` only by the system on the first payment ' +
      '(PLAN A-06). `lost` releases the protection. Same rules as the agent zone (D-469, D-468).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: ChangeAgentLeadStageDto,
    examples: {
      default: { value: { stage: 'negotiating' } },
      lost: { value: { stage: 'lost', lostReason: 'price', note: 'ได้ราคาจากที่อื่นถูกกว่า 8%' } },
    },
  })
  @ApiSuccess(200, {
    description: 'Lead',
    type: AdminAgentLeadDto,
    example: { ...ADMIN_LEAD_EXAMPLE, stage: 'negotiating' },
  })
  @ApiStandardErrors(
    ...WRITE,
    'http.not_found',
    'sales.lead_read_only',
    'agents.lead_closed',
    'agents.lead_stage_final',
  )
  async changeStage(
    @CurrentActor() actor: Actor,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() body: ChangeAgentLeadStageDto,
  ): Promise<AdminAgentLeadDto> {
    const scope = await this.scopes.of(actor);
    const { agent } = await this.scopes.lead(scope, leadId, { write: true, action: 'change_stage' });
    return adminLeadDto(await this.leads.changeStage(scope.actor, agent, leadId, body));
  }

  @Post(':leadId/activities')
  @CanAny('sales.pipeline.self', 'sales.pipeline.manage')
  @ApiParam({ name: 'leadId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.salesLeads.addActivity',
    summary: 'Log a contact with a lead',
    description:
      'A call, LINE chat, visit, e-mail or note in the lead’s timeline (append-only), optionally with the next ' +
      'follow-up; the first one moves a new lead to `contacted` (D-469, D-468).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: AddAgentLeadActivityDto,
    examples: { default: { value: { kind: 'call', body: 'โทรคุยเรื่องขนาดกล่อง ขอดูตัวอย่างก่อนสั่ง' } } },
  })
  @ApiSuccess(201, { description: 'Timeline entry', type: AgentLeadActivityDto, example: ACTIVITY_EXAMPLE })
  @ApiStandardErrors(...WRITE, 'http.not_found', 'sales.lead_read_only', 'agents.lead_closed')
  async addActivity(
    @CurrentActor() actor: Actor,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() body: AddAgentLeadActivityDto,
  ): Promise<AgentLeadActivityDto> {
    const scope = await this.scopes.of(actor);
    const { agent } = await this.scopes.lead(scope, leadId, { write: true, action: 'add_activity' });
    const row = await this.leads.addActivity(scope.actor, agent, leadId, body);
    return activityDto(row, agent.staffUserId ?? agent.userId);
  }

  @Get(':leadId/activities')
  @CanAny('sales.pipeline.self', 'sales.pipeline.manage')
  @ApiParam({ name: 'leadId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.salesLeads.listActivities',
    summary: 'Read a lead’s timeline',
    description:
      'Newest first, cursor paged; `author` `agent` = the lead’s own rep / agent, `getpack` = other staff, ' +
      '`system` = automatic entries (D-469, D-468).',
    implements: DECISIONS,
  })
  @ApiCursorPaginated(AgentLeadActivityDto, { example: ACTIVITY_EXAMPLE })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async activities(
    @CurrentActor() actor: Actor,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Query() q: CursorQuery,
  ) {
    const { agent } = await this.scopes.lead(await this.scopes.of(actor), leadId);
    const page = await this.leads.activities(agent, leadId, q.cursor, q.limit);
    const me = agent.staffUserId ?? agent.userId;
    return { data: page.data.map((r) => activityDto(r, me)), meta: page.meta };
  }
}

/**
 * D-469: quotes on behalf of getpack from the admin zone (a rep for their own leads, a manager for a rep's) — the one
 * store pricing path (D-441) and the agent zone's `/q/{token}` link; the response is the customer's view of the
 * quotation only (no cost, margin or factory). Discount requests go to the approval desk (D-470).
 */
@ApiSurface('admin', 'salesQuotes')
@Controller('sales/quotes')
export class AdminSalesQuotesController {
  constructor(
    private readonly scopes: SalesScopeService,
    private readonly pipeline: SalesPipelineService,
    private readonly quotes: AgentQuotesService,
  ) {}

  @Post()
  @CanAny('sales.pipeline.self', 'sales.pipeline.manage')
  @ApiEndpoint({
    id: 'admin.salesQuotes.create',
    summary: 'Send a quotation to a lead of the pipeline',
    description:
      'Prices the configuration on the store path (D-441), saves it as getpack’s quotation and shares it ' +
      '(`shareUrl` `/q/{token}` carries the rep’s agent code). The lead moves to `quoted`; a big quote registers ' +
      'its deal (D-468). The price is never changed here (D-469).',
    implements: [...DECISIONS, 'D-441'],
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
  @ApiSuccess(201, { description: 'Sent', type: AgentQuoteDto, example: AGENT_QUOTE_EXAMPLE })
  @ApiStandardErrors(
    ...WRITE,
    'http.not_found',
    'sales.lead_read_only',
    'agents.agent_inactive',
    'agents.lead_closed',
    'pricing.not_instant',
    'pricing.vat_rate_missing',
    'quotes.nothing_to_save',
    'numbering.series_missing',
  )
  async create(@CurrentActor() actor: Actor, @Body() body: CreateAgentQuoteDto): Promise<AgentQuoteDto> {
    const row = await this.pipeline.createQuote(await this.scopes.of(actor), body);
    return agentQuoteDto(this.quotes, row);
  }

  @Get()
  @CanAny('sales.pipeline.self', 'sales.pipeline.manage')
  @ApiEndpoint({
    id: 'admin.salesQuotes.list',
    summary: 'List the quotations sent from the pipeline',
    description:
      'A rep’s own (managers: every rep’s, filter `agentId`), newest first, by lead or status (D-469, D-468).',
    implements: DECISIONS,
  })
  @ApiPaginated(AgentQuoteDto, { example: AGENT_QUOTE_EXAMPLE })
  @ApiStandardErrors('validation.failed')
  async list(@CurrentActor() actor: Actor, @Query() q: SalesQuoteListQuery) {
    const { rows, total } = await this.pipeline.listQuotes(await this.scopes.of(actor), q);
    return {
      data: rows.map((r) => agentQuoteDto(this.quotes, r)),
      meta: { page: q.page, perPage: q.perPage, total },
    };
  }

  @Post(':agentQuoteId/discount-requests')
  @CanAny('sales.pipeline.self', 'sales.pipeline.manage')
  @ApiParam({ name: 'agentQuoteId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.salesQuotes.requestDiscount',
    summary: 'Ask for a better price on a quotation',
    description:
      'The agent zone’s give-get request (D-468, PLAN A-10) for a rep’s quotation: what the customer gives in ' +
      'return, the reason and competitor evidence; one open round per quotation. It goes to the discount approval ' +
      'desk (D-470) — a rep never approves their own request (D-469).',
    implements: [...DECISIONS, 'D-470'],
  })
  @ApiBody({
    type: RequestAgentDiscountDto,
    examples: {
      default: {
        value: { requestedPct: '5.00', reason: 'volume', quantityChange: 8000, depositPct: '50.00' },
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
    'sales.lead_read_only',
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
    return discountRequestDto(await this.pipeline.requestDiscount(await this.scopes.of(actor), id, body));
  }

  @Get(':agentQuoteId/discount-requests')
  @CanAny('sales.pipeline.self', 'sales.pipeline.manage')
  @ApiParam({ name: 'agentQuoteId', format: 'uuid' })
  @ApiEndpoint({
    id: 'admin.salesQuotes.discountRequests',
    summary: 'Read the discount rounds of a quotation',
    description:
      'Every round, oldest first, with the options offered (price and the rep’s commission). No cost or margin ' +
      '(D-469, D-470).',
    implements: [...DECISIONS, 'D-470'],
  })
  @ApiSuccess(200, {
    description: 'Rounds',
    type: [AgentDiscountRequestDto],
    example: [DISCOUNT_REQUEST_EXAMPLE],
  })
  @ApiStandardErrors('http.not_found', 'validation.failed')
  async discountRequests(
    @CurrentActor() actor: Actor,
    @Param('agentQuoteId', ParseUUIDPipe) id: string,
  ): Promise<AgentDiscountRequestDto[]> {
    return (await this.pipeline.discountRequests(await this.scopes.of(actor), id)).map(discountRequestDto);
  }
}

/** D-469: the company reps (for filters, pickers and assignment). Managers only. */
@ApiSurface('admin', 'salesReps')
@Controller('sales/reps')
export class AdminSalesRepsController {
  constructor(private readonly pipeline: SalesPipelineService) {}

  @Get()
  @Can('sales.pipeline.manage')
  @ApiEndpoint({
    id: 'admin.salesReps.list',
    summary: 'List the company sales reps',
    description:
      'Staff holding the Sales Rep role or owning an employee agent, with their agent, whether they can be ' +
      'assigned (active staff, active employee agent) and their open leads (D-469, PLAN A-07).',
    implements: ['D-469'],
  })
  @ApiSuccess(200, { description: 'Reps', type: [SalesRepDto], example: [SALES_REP_EXAMPLE] })
  @ApiStandardErrors()
  async list(): Promise<SalesRepDto[]> {
    return (await this.pipeline.reps()).map((r) => ({
      userId: r.user.publicId,
      displayName: r.user.displayName,
      agent: r.agent ? agentRef(r.agent) : null,
      assignable: r.assignable,
      openLeads: r.openLeads,
      openInbound: r.openInbound,
    }));
  }
}
