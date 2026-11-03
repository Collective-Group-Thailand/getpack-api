import { createHash } from 'node:crypto';

import { type Actor, type UserActor } from '@common/context/actor';
import { RequestContext } from '@common/context/request-context';
import { DomainException } from '@common/errors/domain.exception';
import { addCalendarDays, bangkokDate } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma, type SalesAgent, type SalesAgentQuote } from '@generated/prisma/client';
import { canonical } from '@modules/catalog/imports/import-engine';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { SettingsService } from '@platform/settings/settings.service';

import { AgentDealsService } from './agent-deals.service';
import {
  buildOptions,
  type COMMITMENTS,
  conditionsLine,
  type DISCOUNT_REASONS,
  type GiveGet,
  giveGetSha256,
  givesSomething,
  OfferError,
  type OfferInput,
  quotedBase,
  roundRefusal,
} from './agent-discount-rules';
import { AgentLeadsService } from './agent-leads.service';
import { AgentQuotesService, agentQuoteStatus } from './agent-quotes.service';
import { appendLeadActivity, DAY_MS, invalid, planVersionAt, recordAgentEvent } from './agent-shared';

export const DISCOUNT_REQUEST_INCLUDE = {
  options: { orderBy: { position: 'asc' } },
  quoteOption: { select: { publicId: true, quantity: true } },
  competitorFile: { select: { publicId: true, originalName: true } },
} as const satisfies Prisma.SalesAgentDiscountRequestInclude;
export type DiscountRequestRow = Prisma.SalesAgentDiscountRequestGetPayload<{
  include: typeof DISCOUNT_REQUEST_INCLUDE;
}>;

export interface DiscountRequestInput extends Partial<GiveGet> {
  quoteOptionId?: string;
  requestedPct: string;
  reason: (typeof DISCOUNT_REASONS)[number];
  reasonNote?: string | null;
  commitment?: (typeof COMMITMENTS)[number];
  competitorFileId?: string | null;
  competitorSpec?: Record<string, unknown> | null;
}

/** The rates that apply to an agent's next order from a lead: a registered deal's lock, else the plan in force. */
export interface StandardRate {
  firstOrderPct: string;
  repeatOrderPct: string;
  /** The rate of the next order (first or repeat). */
  ratePct: string;
  minBase: string;
  source: 'plan' | 'deal_registration';
}

/**
 * D-468 (Phase 3 item 3, PLAN A-10 / A-05): an agent's discount request on a quote they sent — give-get first,
 * competitor evidence with a like-for-like spec, one open round per quote version and a further round only when the
 * give-get changed; every round is kept (negotiation history for Phase 4). Phase 4's desk answers through
 * `offerOptions` (1–3 options; the first always at the FULL standard rate); a co-fund (lower rate) or spiff option
 * becomes effective only when the agent accepts it (`acceptOption`, audited with evidence).
 */
@Injectable()
export class AgentDiscountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly quotes: AgentQuotesService,
    private readonly leads: AgentLeadsService,
    private readonly audit: AuditService,
    readonly events: DomainEvents,
    readonly activity: ActivityLogService,
    private readonly deals: AgentDealsService,
  ) {}

  async requests(agent: SalesAgent, agentQuoteId: string): Promise<DiscountRequestRow[]> {
    const row = await this.quotes.get(agent, agentQuoteId);
    return this.prisma.salesAgentDiscountRequest.findMany({
      where: { agentQuoteId: row.id },
      include: DISCOUNT_REQUEST_INCLUDE,
      orderBy: { round: 'asc' },
    });
  }

  async request(
    actor: UserActor,
    agent: SalesAgent,
    agentQuoteId: string,
    input: DiscountRequestInput,
  ): Promise<DiscountRequestRow> {
    if (agent.status !== 'active') throw new DomainException('agents.agent_inactive');
    const aq = await this.quotes.get(agent, agentQuoteId);
    const status = agentQuoteStatus(aq);
    if (status !== 'sent' && status !== 'opened')
      throw new DomainException('agents.quote_closed', { params: { status } });
    const option = input.quoteOptionId
      ? aq.quote.options.find((o) => o.publicId === input.quoteOptionId)
      : aq.quote.options.at(-1);
    if (!option) invalid('quoteOptionId', 'a quantity of this quotation', 'invalid');
    const giveGet: GiveGet = {
      quantityChange: input.quantityChange ?? null,
      commitment: input.commitment ?? 'one_off',
      commitmentMonths: input.commitmentMonths ?? null,
      depositPct: input.depositPct ?? null,
      cashWithinDays: input.cashWithinDays ?? null,
      leadTimeFlexDays: input.leadTimeFlexDays ?? null,
      specChange: input.specChange?.trim() || null,
    };
    if (giveGet.commitment === 'call_off' && !giveGet.commitmentMonths)
      invalid('commitmentMonths', 'the months of the call-off agreement', 'required');
    // A-10: a discount is give-get — the customer gives something in return.
    if (!givesSomething(giveGet))
      invalid('quantityChange', 'what the customer gives in return (give-get)', 'give_get_required');
    if (input.reason === 'competitor_price' && !input.competitorFileId && !input.competitorSpec)
      invalid('competitorSpec', 'the competitor’s offer (file or like-for-like spec)', 'required');
    const sha = giveGetSha256(giveGet);
    const id = await this.prisma.withTx(async (tx) => {
      const previous = await tx.salesAgentDiscountRequest.findMany({
        where: { quoteId: aq.quoteId },
        orderBy: { round: 'asc' },
        select: { status: true, giveGetSha256: true, round: true },
      });
      const refusal = roundRefusal(previous, sha);
      if (refusal) throw new DomainException(refusal);
      const file = input.competitorFileId
        ? await tx.fileObject.findFirst({
            where: {
              publicId: input.competitorFileId,
              purgedAt: null,
              OR: [{ ownerUserId: actor.userId }, { createdById: actor.userId }],
            },
            select: { id: true },
          })
        : null;
      if (input.competitorFileId && !file)
        invalid('competitorFileId', 'a file I uploaded (purpose evidence)', 'invalid');
      const row = await tx.salesAgentDiscountRequest.create({
        data: {
          agentId: agent.id,
          agentQuoteId: aq.id,
          quoteId: aq.quoteId,
          quoteOptionId: option.id,
          round: (previous.at(-1)?.round ?? 0) + 1,
          requestedPct: input.requestedPct,
          reason: input.reason,
          reasonNote: input.reasonNote?.trim() || null,
          quantityChange: giveGet.quantityChange,
          commitment: giveGet.commitment,
          commitmentMonths: giveGet.commitmentMonths,
          depositPct: giveGet.depositPct,
          cashWithinDays: giveGet.cashWithinDays,
          leadTimeFlexDays: giveGet.leadTimeFlexDays,
          specChange: giveGet.specChange,
          giveGetSha256: Uint8Array.from(sha),
          competitorFileId: file?.id ?? null,
          competitorSpec: (input.competitorSpec ?? undefined) as Prisma.InputJsonValue | undefined,
          createdById: actor.userId,
        },
      });
      await this.leads.systemAdvance(tx, aq.leadId, 'discount_requested', {
        data: { agentQuoteId: aq.publicId, round: row.round },
        createdById: actor.userId,
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_discount.requested',
        aggregateType: 'sales_agent_discount_request',
        aggregateId: row.publicId,
        payload: {
          requestId: row.publicId,
          agentQuoteId: aq.publicId,
          agentCode: agent.code,
          quoteCode: aq.quote.quoteCode,
          round: row.round,
          requestedPct: row.requestedPct.toString(),
          reason: row.reason,
        },
        actor,
      });
      return row.id;
    });
    return this.prisma.salesAgentDiscountRequest.findUniqueOrThrow({
      where: { id },
      include: DISCOUNT_REQUEST_INCLUDE,
    });
  }

  /**
   * The rate in force for the agent's next order from this quote's lead: a registered deal's lock (item 4 hook), else
   * the plan version in force now — first-order rate until the lead's customer has a commissioned order, then repeat.
   */
  async standardRate(tx: Tx, aq: Pick<SalesAgentQuote, 'id' | 'agentId' | 'leadId'>): Promise<StandardRate> {
    const agent = await tx.salesAgent.findUniqueOrThrow({ where: { id: aq.agentId } });
    const version = await planVersionAt(tx, agent.planId, new Date());
    if (!version) throw new DomainException('agents.plan_not_in_force');
    const lock = await this.lockFor(tx, aq.id);
    const first = lock?.firstOrderPct ?? version.firstOrderPct.toString();
    const repeat = lock?.repeatOrderPct ?? version.repeatOrderPct.toString();
    const commissioned = await tx.salesAgentCommission.count({
      where: { agentId: agent.id, kind: 'order', link: { leadId: aq.leadId } },
    });
    return {
      firstOrderPct: first,
      repeatOrderPct: repeat,
      ratePct: commissioned > 0 ? repeat : first,
      minBase: version.minBaseAmount.toFixed(2),
      source: lock ? 'deal_registration' : 'plan',
    };
  }

  /** The rates a registered deal locked for this agent quote (D-468 item 4). */
  private lockFor(
    tx: Tx,
    agentQuoteId: bigint,
  ): Promise<{ firstOrderPct: string; repeatOrderPct: string } | null> {
    return this.deals.lockFor(tx, agentQuoteId);
  }

  /**
   * Phase 4's answer (internal; the desk endpoint comes with D-470): 1–3 options at server-computed amounts. The
   * first is `standard` at the FULL standard rate; co-fund lower, spiff higher. Valid for
   * `quotes.discounted_validity_days` (7) from now. The agent is told.
   */
  async offerOptions(
    actor: Actor,
    requestPublicId: string,
    offers: readonly OfferInput[],
    note?: string,
  ): Promise<DiscountRequestRow> {
    const id = await this.prisma.withTx((tx) =>
      this.offerOptionsInTx(tx, actor, requestPublicId, offers, note),
    );
    return this.prisma.salesAgentDiscountRequest.findUniqueOrThrow({
      where: { id },
      include: DISCOUNT_REQUEST_INCLUDE,
    });
  }

  /** `offerOptions` in the caller's transaction (D-470: the approval desk decides and offers in one transaction). */
  async offerOptionsInTx(
    tx: Tx,
    actor: Actor,
    requestPublicId: string,
    offers: readonly OfferInput[],
    note?: string,
  ): Promise<bigint> {
    const now = new Date();
    const days = await this.settings.value('quotes.discounted_validity_days', now);
    const req = await tx.salesAgentDiscountRequest.findUnique({
      where: { publicId: requestPublicId },
      include: {
        agentQuote: true,
        quoteOption: true,
        agent: { select: { user: { select: { publicId: true } } } },
      },
    });
    if (!req) throw new DomainException('http.not_found');
    if (req.status !== 'open')
      throw new DomainException('agents.discount_request_closed', { params: { status: req.status } });
    const rate = await this.standardRate(tx, req.agentQuote);
    const result = req.quoteOption.result as { shippingNetAmount?: string | null };
    const base = quotedBase({
      netAmount: req.quoteOption.netAmount.toFixed(2),
      shippingNetAmount: result.shippingNetAmount ?? null,
    });
    let built;
    try {
      built = buildOptions(offers, { base, standardRatePct: rate.ratePct, minBase: rate.minBase });
    } catch (error) {
      if (error instanceof OfferError) invalid('options', error.message, error.problem);
      throw error;
    }
    const validUntil = new Date(now.getTime() + days * DAY_MS);
    const conditions = conditionsLine(
      {
        quantityChange: req.quantityChange,
        commitment: req.commitment,
        commitmentMonths: req.commitmentMonths,
        depositPct: req.depositPct?.toString() ?? null,
        cashWithinDays: req.cashWithinDays,
        leadTimeFlexDays: req.leadTimeFlexDays,
        specChange: req.specChange,
      },
      req.quoteOption.quantity,
      bangkokDate(validUntil),
    );
    for (const o of built)
      await tx.salesAgentDiscountOption.create({
        data: {
          requestId: req.id,
          ...o,
          conditionsTh: conditions.th,
          conditionsEn: conditions.en,
          validUntil,
          offeredById: actor.type === 'user' ? actor.userId : null,
          offeredAt: now,
        },
      });
    await tx.salesAgentDiscountRequest.update({
      where: { id: req.id },
      data: {
        status: 'offered',
        decidedAt: now,
        decidedById: actor.type === 'user' ? actor.userId : null,
        decisionNote: note?.trim() || null,
        rowVersion: { increment: 1 },
      },
    });
    await appendLeadActivity(tx, {
      leadId: req.agentQuote.leadId,
      kind: 'system',
      data: { event: 'discount_options', agentQuoteId: req.agentQuote.publicId, round: req.round },
      occurredAt: now,
    });
    await recordAgentEvent(this, tx, {
      type: 'sales_agent_discount.options_offered',
      aggregateType: 'sales_agent_discount_request',
      aggregateId: req.publicId,
      // `customerId` addresses the agent's notification. No cost or margin in the payload (D-464).
      payload: {
        requestId: req.publicId,
        options: built.length,
        validUntilDate: addCalendarDays(bangkokDate(validUntil), 0),
        customerId: req.agent.user.publicId,
      },
      actor,
    });
    return req.id;
  }

  /**
   * The agent accepts one offered option (their own act — the only way a co-fund lower rate ever applies, A-05).
   * Evidence: ip, user agent, time and the option snapshot with its SHA-256. The other options lapse.
   */
  async acceptOption(
    actor: UserActor,
    agent: SalesAgent,
    agentQuoteId: string,
    optionPublicId: string,
  ): Promise<DiscountRequestRow> {
    const aq = await this.quotes.get(agent, agentQuoteId);
    const ctx = RequestContext.current();
    const id = await this.prisma.withTx(async (tx) => {
      const option = await tx.salesAgentDiscountOption.findUnique({
        where: { publicId: optionPublicId },
        include: { request: true },
      });
      if (!option || option.request.agentQuoteId !== aq.id) throw new DomainException('http.not_found');
      const now = new Date();
      if (option.request.status !== 'offered' || option.status !== 'offered' || option.validUntil <= now)
        throw new DomainException('agents.discount_option_unavailable');
      const snapshot = {
        optionId: option.publicId,
        requestId: option.request.publicId,
        quoteId: aq.quote.publicId,
        kind: option.kind,
        discountPct: option.discountPct.toFixed(4),
        baseAmount: option.baseAmount.toFixed(2),
        netAmount: option.netAmount.toFixed(2),
        ratePct: option.ratePct.toFixed(4),
        standardRatePct: option.standardRatePct.toFixed(4),
        commissionAmount: option.commissionAmount.toFixed(2),
        conditionsTh: option.conditionsTh,
        validUntil: option.validUntil.toISOString(),
        acceptedAt: now.toISOString(),
      };
      const sha = createHash('sha256')
        .update(JSON.stringify(canonical(snapshot)))
        .digest();
      const { count } = await tx.salesAgentDiscountOption.updateMany({
        where: { id: option.id, status: 'offered' },
        data: {
          status: 'accepted',
          acceptedAt: now,
          acceptedById: actor.userId,
          acceptedIp: ctx?.ip ?? null,
          acceptedUserAgent: ctx?.userAgent?.slice(0, 500) ?? null,
          acceptedSnapshot: snapshot,
          acceptedSha256: Uint8Array.from(sha),
          rowVersion: { increment: 1 },
        },
      });
      if (count === 0) throw new DomainException('agents.discount_option_unavailable');
      await tx.salesAgentDiscountOption.updateMany({
        where: { requestId: option.requestId, id: { not: option.id }, status: 'offered' },
        data: { status: 'lapsed' },
      });
      await tx.salesAgentDiscountRequest.update({
        where: { id: option.requestId },
        data: { status: 'accepted', rowVersion: { increment: 1 } },
      });
      await this.afterAccept(tx, aq.id, option.id, actor);
      await this.audit.record(tx, {
        category: 'finance',
        action: 'sales_agent_discount.option_accepted',
        resourceType: 'sales_agent_discount_option',
        resourcePublicId: option.publicId,
        actor,
        data: { kind: option.kind, ratePct: snapshot.ratePct, standardRatePct: snapshot.standardRatePct },
      });
      await appendLeadActivity(tx, {
        leadId: aq.leadId,
        kind: 'system',
        data: { event: 'discount_option_accepted', agentQuoteId: aq.publicId, kind: option.kind },
        createdById: actor.userId,
        occurredAt: now,
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_discount.option_accepted',
        aggregateType: 'sales_agent_discount_request',
        aggregateId: option.request.publicId,
        payload: {
          requestId: option.request.publicId,
          optionId: option.publicId,
          kind: option.kind,
          ratePct: snapshot.ratePct,
          evidenceSha256: sha.toString('hex'),
        },
        actor,
      });
      return option.requestId;
    });
    return this.prisma.salesAgentDiscountRequest.findUniqueOrThrow({
      where: { id },
      include: DISCOUNT_REQUEST_INCLUDE,
    });
  }

  /** Item 4 hook: a registered deal takes the accepted option's rate. */
  protected async afterAccept(
    _tx: Tx,
    _agentQuoteId: bigint,
    _optionId: bigint,
    _actor: UserActor,
  ): Promise<void> {
    // Filled by deal registration.
  }
}
