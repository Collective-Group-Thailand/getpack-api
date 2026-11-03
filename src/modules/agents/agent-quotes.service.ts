import { randomUUID } from 'node:crypto';

import { systemActor, type UserActor } from '@common/context/actor';
import { FieldEncryption } from '@common/crypto/field-encryption';
import { DomainException } from '@common/errors/domain.exception';
import { AppConfig } from '@config/app-config';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma, type SalesAgent, type SalesAgentQuoteStatus } from '@generated/prisma/client';
import { QUOTE_INCLUDE, type QuoteRow, SavedQuotesService } from '@modules/quotes/saved-quotes.service';
import { Injectable, Logger } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

import { AgentDealsService } from './agent-deals.service';
import { AgentLeadsService } from './agent-leads.service';
import { appendLeadActivity, recordAgentEvent } from './agent-shared';

export const AGENT_QUOTE_INCLUDE = {
  quote: { include: QUOTE_INCLUDE },
  lead: { select: { publicId: true, contactName: true, organisationName: true } },
  agent: { select: { code: true, status: true } },
  dealRegistration: true,
} as const satisfies Prisma.SalesAgentQuoteInclude;
export type AgentQuoteRow = Prisma.SalesAgentQuoteGetPayload<{ include: typeof AGENT_QUOTE_INCLUDE }>;

export interface AgentQuoteInput {
  leadId: string;
  productTypeCode: string;
  configuration: Record<string, unknown>;
  deliveryPostcode?: string;
  targetPricePerUnit?: string | null;
}

/** The agent-facing status of a sent quote at `now` (a quote past its validity reads `expired`). */
export function agentQuoteStatus(
  row: { status: SalesAgentQuoteStatus; quote: { status: string; validUntil: Date } },
  now = new Date(),
): SalesAgentQuoteStatus {
  if (row.status === 'withdrawn' || row.status === 'accepted') return row.status;
  if (row.quote.status === 'converted') return 'accepted';
  if (['expired', 'superseded'].includes(row.quote.status) || row.quote.validUntil <= now) return 'expired';
  return row.status;
}

/**
 * D-468 (Phase 3 item 2): quotes an agent sends to a lead on behalf of getpack. The quote is priced and saved by the
 * one store path (`SavedQuotesService.save` with an anonymous store owner: store rules and the D-441 default spec,
 * instant products only) — getpack owns it, no customer until the lead signs up — and shared at once; the link
 * `/q/{token}` carries the agent's code (the web sets the agent cookie like `/a/{code}`). The agent never changes a
 * price or gives a discount (they ask for one, item 3). Opening and acceptance are written to the lead's timeline.
 */
@Injectable()
export class AgentQuotesService {
  private readonly logger = new Logger(AgentQuotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quotes: SavedQuotesService,
    private readonly leads: AgentLeadsService,
    private readonly encryption: FieldEncryption,
    private readonly config: AppConfig,
    readonly events: DomainEvents,
    readonly activity: ActivityLogService,
    private readonly deals: AgentDealsService,
  ) {}

  shareUrl(token: string): string {
    const web = this.config.get('STOREFRONT_BASE_URL') ?? 'https://www.getpack.invalid';
    return `${web.replace(/\/$/, '')}/q/${token}`;
  }

  /** The link the agent can copy again, while it resolves. */
  linkOf(row: AgentQuoteRow, now = new Date()): string | null {
    if (!row.shareTokenEnc || agentQuoteStatus(row, now) === 'withdrawn') return null;
    if (row.quote.status !== 'shared' || !row.quote.shareExpiresAt || row.quote.shareExpiresAt <= now)
      return null;
    return this.shareUrl(this.encryption.decrypt(row.shareTokenEnc));
  }

  async create(actor: UserActor, agent: SalesAgent, input: AgentQuoteInput): Promise<AgentQuoteRow> {
    if (agent.status !== 'active') throw new DomainException('agents.agent_inactive');
    const lead = await this.leads.mine(agent, input.leadId);
    if (!['registered', 'converted'].includes(lead.status) || ['won', 'lost'].includes(lead.stage))
      throw new DomainException('agents.lead_closed', { params: { status: lead.status } });
    const anonymousId = randomUUID();
    const owner = { kind: 'anonymous' as const, anonymousId };
    // The one store pricing path (D-441): store validation, store rules, the engine, frozen spec lines.
    const saved = await this.quotes.save(owner, 'web', {
      productTypeCode: input.productTypeCode,
      configuration: input.configuration,
      ...(input.deliveryPostcode && { deliveryPostcode: input.deliveryPostcode }),
      anonymousId,
      targetPricePerUnit: input.targetPricePerUnit ?? null,
    });
    const { token } = await this.quotes.share(owner, saved.publicId);
    const id = await this.prisma.withTx(async (tx) => {
      const now = new Date();
      // A converted lead's customer can order the quote at once (their own quote, D-051 ownership).
      if (lead.convertedUserId)
        await tx.quote.update({
          where: { id: saved.id },
          data: { customerUserId: lead.convertedUserId, rowVersion: { increment: 1 } },
        });
      const row = await tx.salesAgentQuote.create({
        data: {
          agentId: agent.id,
          leadId: lead.id,
          quoteId: saved.id,
          anonymousId,
          shareTokenEnc: this.encryption.encrypt(token),
          sentAt: now,
        },
      });
      await this.leads.systemAdvance(tx, lead.id, 'quote_sent', {
        data: { agentQuoteId: row.publicId },
        createdById: actor.userId,
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_quote.sent',
        aggregateType: 'sales_agent_quote',
        aggregateId: row.publicId,
        payload: { agentQuoteId: row.publicId, leadId: lead.publicId, quoteId: saved.publicId },
        actor,
      });
      await this.afterCreate(tx, row.id, actor);
      return row.publicId;
    });
    return this.get(agent, id);
  }

  /** D-468 item 4: a big quote registers its deal (or joins the lead's active registration). */
  private afterCreate(tx: Tx, agentQuoteId: bigint, actor: UserActor): Promise<void> {
    return this.deals.autoRegister(tx, agentQuoteId, actor);
  }

  /** D-468 item 4: the agent registers a smaller quote's deal (no approval — protection and rate lock only). */
  async registerDeal(actor: UserActor, agent: SalesAgent, publicId: string): Promise<AgentQuoteRow> {
    if (agent.status !== 'active') throw new DomainException('agents.agent_inactive');
    const row = await this.get(agent, publicId);
    const status = agentQuoteStatus(row);
    if (status !== 'sent' && status !== 'opened')
      throw new DomainException('agents.quote_closed', { params: { status } });
    if (row.dealRegistration?.status === 'registered') return row;
    await this.prisma.withTx((tx) => this.deals.register(tx, row.id, 'requested', actor));
    return this.get(agent, publicId);
  }

  async get(agent: SalesAgent, publicId: string, db: Tx = this.prisma): Promise<AgentQuoteRow> {
    const row = await db.salesAgentQuote.findUnique({ where: { publicId }, include: AGENT_QUOTE_INCLUDE });
    if (!row || row.agentId !== agent.id) throw new DomainException('http.not_found');
    return row;
  }

  async list(
    agent: SalesAgent,
    filter: { leadId?: string; status?: SalesAgentQuoteStatus },
    page: number,
    perPage: number,
  ): Promise<[AgentQuoteRow[], number]> {
    const now = new Date();
    const status: Prisma.SalesAgentQuoteWhereInput | undefined =
      filter.status === undefined
        ? undefined
        : filter.status === 'expired'
          ? {
              status: { in: ['sent', 'opened'] },
              quote: { OR: [{ status: { in: ['expired', 'superseded'] } }, { validUntil: { lte: now } }] },
            }
          : filter.status === 'accepted'
            ? { OR: [{ status: 'accepted' }, { quote: { status: 'converted' } }] }
            : filter.status === 'withdrawn'
              ? { status: 'withdrawn' }
              : {
                  status: filter.status,
                  quote: {
                    status: { notIn: ['expired', 'superseded', 'converted'] },
                    validUntil: { gt: now },
                  },
                };
    const where: Prisma.SalesAgentQuoteWhereInput = {
      agentId: agent.id,
      ...(filter.leadId && { lead: { publicId: filter.leadId } }),
      ...status,
    };
    return Promise.all([
      this.prisma.salesAgentQuote.findMany({
        where,
        include: AGENT_QUOTE_INCLUDE,
        orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.salesAgentQuote.count({ where }),
    ]);
  }

  /** A new link (the previous one stops resolving); live quotes only. */
  async resend(actor: UserActor, agent: SalesAgent, publicId: string): Promise<AgentQuoteRow> {
    const row = await this.get(agent, publicId);
    const status = agentQuoteStatus(row);
    if (status === 'withdrawn' || status === 'expired' || status === 'accepted')
      throw new DomainException('agents.quote_closed', { params: { status } });
    const { token } = await this.quotes.share(
      { kind: 'anonymous', anonymousId: row.anonymousId },
      row.quote.publicId,
    );
    await this.prisma.withTx(async (tx) => {
      await tx.salesAgentQuote.update({
        where: { id: row.id },
        data: {
          shareTokenEnc: this.encryption.encrypt(token),
          sendCount: { increment: 1 },
          rowVersion: { increment: 1 },
        },
      });
      await appendLeadActivity(tx, {
        leadId: row.leadId,
        kind: 'quote_sent',
        data: { agentQuoteId: row.publicId, resend: true },
        createdById: actor.userId,
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_quote.resent',
        aggregateType: 'sales_agent_quote',
        aggregateId: row.publicId,
        payload: { agentQuoteId: row.publicId, sendCount: row.sendCount + 1 },
        actor,
      });
    });
    return this.get(agent, publicId);
  }

  /** The link stops resolving at once; the quote stays saved (getpack's). */
  async withdraw(
    actor: UserActor,
    agent: SalesAgent,
    publicId: string,
    reason?: string,
  ): Promise<AgentQuoteRow> {
    const row = await this.get(agent, publicId);
    const status = agentQuoteStatus(row);
    if (status === 'withdrawn' || status === 'accepted')
      throw new DomainException('agents.quote_closed', { params: { status } });
    if (row.quote.shareTokenHash)
      await this.quotes.unshare({ kind: 'anonymous', anonymousId: row.anonymousId }, row.quote.publicId);
    await this.prisma.withTx(async (tx) => {
      const now = new Date();
      await tx.salesAgentQuote.update({
        where: { id: row.id },
        data: {
          status: 'withdrawn',
          withdrawnAt: now,
          withdrawnReason: reason?.trim() || null,
          shareTokenEnc: null,
          rowVersion: { increment: 1 },
        },
      });
      await appendLeadActivity(tx, {
        leadId: row.leadId,
        kind: 'system',
        body: reason?.trim() || null,
        data: { event: 'quote_withdrawn', agentQuoteId: row.publicId },
        createdById: actor.userId,
        occurredAt: now,
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_quote.withdrawn',
        aggregateType: 'sales_agent_quote',
        aggregateId: row.publicId,
        payload: { agentQuoteId: row.publicId },
        actor,
      });
    });
    return this.get(agent, publicId);
  }

  /**
   * `/q/{token}` was opened (`store.quotes.getShared`): the agent code for the web's agent cookie, and the first open
   * recorded once (status `opened`, the lead's timeline, `sales_agent_quote.opened` to the agent). Never fails the read.
   */
  async opened(quote: QuoteRow): Promise<string | null> {
    try {
      const row = await this.prisma.salesAgentQuote.findUnique({
        where: { quoteId: quote.id },
        include: { agent: { select: { code: true, status: true, user: { select: { publicId: true } } } } },
      });
      if (!row) return null;
      if (!row.openedAt && row.status === 'sent')
        await this.prisma.withTx(async (tx) => {
          const now = new Date();
          const { count } = await tx.salesAgentQuote.updateMany({
            where: { id: row.id, openedAt: null, status: 'sent' },
            data: { status: 'opened', openedAt: now },
          });
          if (count === 0) return;
          const lead = await tx.salesAgentLead.findUniqueOrThrow({ where: { id: row.leadId } });
          await appendLeadActivity(tx, {
            leadId: row.leadId,
            kind: 'system',
            data: { event: 'quote_opened', agentQuoteId: row.publicId },
            occurredAt: now,
          });
          await recordAgentEvent(this, tx, {
            type: 'sales_agent_quote.opened',
            aggregateType: 'sales_agent_quote',
            aggregateId: row.publicId,
            // `customerId` addresses the agent's notification (they are a customer account).
            payload: {
              agentQuoteId: row.publicId,
              leadId: lead.publicId,
              contactName: lead.contactName,
              quoteCode: quote.quoteCode,
              customerId: row.agent.user.publicId,
            },
            actor: systemActor('agents.quote_opened'),
          });
        });
      return row.agent.status === 'active' ? row.agent.code : null;
    } catch (error) {
      this.logger.warn(`agent quote open not recorded: ${(error as Error).message}`);
      return null;
    }
  }

  /** The customer put the quote in a cart (`quote.converted`): accepted, in the lead's timeline. */
  @OnDomainEvent('quote.converted', { consumer: 'agents.quote_accepted' })
  async onConverted(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const quote = await tx.quote.findUnique({ where: { publicId: event.aggregateId }, select: { id: true } });
    if (!quote) return;
    const row = await tx.salesAgentQuote.findUnique({ where: { quoteId: quote.id } });
    if (!row || row.status === 'accepted' || row.status === 'withdrawn') return;
    const now = new Date();
    await tx.salesAgentQuote.update({
      where: { id: row.id },
      data: { status: 'accepted', acceptedAt: now, rowVersion: { increment: 1 } },
    });
    await appendLeadActivity(tx, {
      leadId: row.leadId,
      kind: 'system',
      data: { event: 'quote_accepted', agentQuoteId: row.publicId },
      occurredAt: now,
    });
    await recordAgentEvent(this, tx, {
      type: 'sales_agent_quote.accepted',
      aggregateType: 'sales_agent_quote',
      aggregateId: row.publicId,
      payload: { agentQuoteId: row.publicId },
      actor: systemActor('agents.quote_accepted'),
    });
  }

  /** The quote's validity ended (`quote.expired`). */
  @OnDomainEvent('quote.expired', { consumer: 'agents.quote_expired' })
  async onExpired(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const quote = await tx.quote.findUnique({ where: { publicId: event.aggregateId }, select: { id: true } });
    if (!quote) return;
    await tx.salesAgentQuote.updateMany({
      where: { quoteId: quote.id, status: { in: ['sent', 'opened'] } },
      data: { status: 'expired', rowVersion: { increment: 1 } },
    });
  }
}
