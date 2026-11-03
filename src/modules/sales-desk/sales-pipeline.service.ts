import { DomainException } from '@common/errors/domain.exception';
import { cursorPaginated } from '@common/pagination/pagination';
import { SortOrder } from '@common/pagination/pagination.dto';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { AgentAttributionService, LEAD_INCLUDE } from '@modules/agents/agent-attribution.service';
import { AgentDiscountsService } from '@modules/agents/agent-discounts.service';
import { AgentLeadsService, decodeLeadCursor, leadListWhere } from '@modules/agents/agent-leads.service';
import { AGENT_QUOTE_INCLUDE, AgentQuotesService } from '@modules/agents/agent-quotes.service';
import { type CreateAgentQuoteDto, type RequestAgentDiscountDto } from '@modules/agents/agents-quotes.dto';
import { Injectable } from '@nestjs/common';

import {
  type CreateSalesLeadDto,
  type SalesLeadListQuery,
  type SalesQuoteListQuery,
} from './sales-pipeline.dto';
import { type SalesScope, SalesScopeService } from './sales-scope';

/**
 * D-469 (PLAN A-07): the staff side of the one lead pipeline. Every change goes through the agent programme's own
 * services (same rules, events, timeline and protection as the agent zone — D-417, D-440, D-468); this service only
 * resolves whose employee agent acts and what the caller may see.
 */
@Injectable()
export class SalesPipelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: SalesScopeService,
    private readonly leads: AgentLeadsService,
    private readonly attribution: AgentAttributionService,
    private readonly quotes: AgentQuotesService,
    private readonly discounts: AgentDiscountsService,
  ) {}

  async list(scope: SalesScope, q: SalesLeadListQuery, now = new Date()) {
    const base = leadListWhere(BigInt(0), q, now);
    const rest = (base.AND as Prisma.SalesAgentLeadWhereInput[]).slice(1);
    const where: Prisma.SalesAgentLeadWhereInput = {
      AND: [{ kind: 'customer', ...this.scopes.leadWhere(scope, q) }, ...rest],
    };
    const dir = q.order === SortOrder.Asc ? 'asc' : 'desc';
    const orderBy: Prisma.SalesAgentLeadOrderByWithRelationInput[] = [
      q.sort === 'nextFollowUpAt' || q.sort === 'expectedValue' || q.sort === 'score'
        ? { [q.sort]: { sort: dir, nulls: 'last' } }
        : { [q.sort]: dir },
      { id: dir },
    ];
    const cursor = q.cursor ? decodeLeadCursor(q.cursor) : null;
    const rows = await this.prisma.salesAgentLead.findMany({
      where,
      include: LEAD_INCLUDE,
      orderBy,
      take: q.limit + 1,
      ...(cursor && { cursor: { publicId: cursor }, skip: 1 }),
    });
    return cursorPaginated(rows, q.limit, (r) => ({ id: r.publicId }));
  }

  async create(scope: SalesScope, body: CreateSalesLeadDto) {
    const agent = await this.scopes.agentFor(scope, body.agentId);
    const { agentId: _agentId, ...input } = body;
    return this.attribution.registerLead(scope.actor, agent, input);
  }

  async listQuotes(scope: SalesScope, q: SalesQuoteListQuery) {
    const where: Prisma.SalesAgentQuoteWhereInput = {
      ...(scope.manage
        ? { agent: { kind: 'employee', ...(q.agentId && { publicId: q.agentId }) } }
        : { agentId: scope.ownAgent?.id ?? BigInt(-1) }),
      ...(q.leadId && { lead: { publicId: q.leadId } }),
    };
    if (q.status) {
      const owned = await this.prisma.salesAgentQuote.findMany({ where, select: { agentId: true } });
      const agentIds = [...new Set(owned.map((o) => o.agentId))];
      // The status rules (expiry, conversion) are the agent zone's: list per agent through its service.
      const pages = await Promise.all(
        agentIds.map(async (id) => {
          const agent = await this.prisma.salesAgent.findUniqueOrThrow({ where: { id } });
          return (await this.quotes.list(agent, { leadId: q.leadId, status: q.status }, 1, 1000))[0];
        }),
      );
      const all = pages.flat().sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
      return {
        rows: all.slice((q.page - 1) * q.perPage, q.page * q.perPage),
        total: all.length,
      };
    }
    const [rows, total] = await Promise.all([
      this.prisma.salesAgentQuote.findMany({
        where,
        include: AGENT_QUOTE_INCLUDE,
        orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
      }),
      this.prisma.salesAgentQuote.count({ where }),
    ]);
    return { rows, total };
  }

  /** A quote on behalf of getpack for one of the caller's (or, for a manager, a rep's) leads. */
  async createQuote(scope: SalesScope, body: CreateAgentQuoteDto) {
    const { agent } = await this.scopes.lead(scope, body.leadId, { write: true, action: 'quote' });
    return this.quotes.create(scope.actor, agent, body);
  }

  async agentQuote(scope: SalesScope, agentQuotePublicId: string, write: boolean) {
    const row = await this.prisma.salesAgentQuote.findUnique({
      where: { publicId: agentQuotePublicId },
      include: { lead: { select: { publicId: true } } },
    });
    if (!row) throw new DomainException('http.not_found');
    const { agent } = await this.scopes.lead(scope, row.lead.publicId, { write, action: 'discount_request' });
    return { agent, row };
  }

  async requestDiscount(scope: SalesScope, agentQuotePublicId: string, body: RequestAgentDiscountDto) {
    const { agent } = await this.agentQuote(scope, agentQuotePublicId, true);
    return this.discounts.request(scope.actor, agent, agentQuotePublicId, {
      ...body,
      competitorSpec: body.competitorSpec ? { ...body.competitorSpec } : null,
    });
  }

  async discountRequests(scope: SalesScope, agentQuotePublicId: string) {
    const { agent } = await this.agentQuote(scope, agentQuotePublicId, false);
    return this.discounts.requests(agent, agentQuotePublicId);
  }

  /** The company reps: active `sales_rep` staff and their employee agents (for pickers and assignment). */
  async reps() {
    const role = await this.prisma.role.findUnique({ where: { key: 'sales_rep' } });
    const now = new Date();
    const holders = role
      ? await this.prisma.userRole.findMany({
          where: {
            roleId: role.id,
            revokedAt: null,
            validFrom: { lte: now },
            OR: [{ validTo: null }, { validTo: { gt: now } }],
          },
          select: { userId: true },
        })
      : [];
    const agents = await this.prisma.salesAgent.findMany({
      where: { kind: 'employee', staffUserId: { not: null }, status: { not: 'ended' } },
    });
    const userIds = [...new Set([...holders.map((h) => h.userId), ...agents.map((a) => a.staffUserId!)])];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, publicId: true, displayName: true, status: true },
      orderBy: { displayName: 'asc' },
    });
    const open = await this.prisma.salesAgentLead.groupBy({
      by: ['agentId'],
      where: {
        agentId: { in: agents.map((a) => a.id) },
        status: { in: ['registered', 'converted'] },
        stage: { notIn: ['won', 'lost'] },
      },
      _count: { _all: true },
    });
    const openOf = new Map(open.map((o) => [o.agentId, o._count._all]));
    const inbound = await this.prisma.salesInboundLead.groupBy({
      by: ['assigneeUserId'],
      where: { assigneeUserId: { in: userIds }, status: { notIn: ['converted_to_lead', 'disqualified'] } },
      _count: { _all: true },
    });
    const inboundOf = new Map(inbound.map((o) => [o.assigneeUserId, o._count._all]));
    const isRep = new Set(holders.map((h) => h.userId));
    return users.map((u) => {
      const agent = agents.find((a) => a.staffUserId === u.id) ?? null;
      return {
        user: u,
        agent,
        assignable: u.status === 'active' && isRep.has(u.id) && agent?.status === 'active',
        openLeads: agent ? (openOf.get(agent.id) ?? 0) : 0,
        openInbound: inboundOf.get(u.id) ?? 0,
      };
    });
  }
}
