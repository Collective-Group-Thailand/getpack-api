import { type Actor, systemActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { MoneyDecimal } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma, type SalesAgentDealRegistration } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { SettingsService } from '@platform/settings/settings.service';

import { type RateLock } from './agent-commission-rules';
import { quotedBase } from './agent-discount-rules';
import { appendLeadActivity, DAY_MS, planVersionAt, recordAgentEvent } from './agent-shared';

/** The largest commission base among a quote's quantities (D-418 base: before VAT, excl. shipping). */
export function largestBase(
  options: readonly { netAmount: { toFixed(dp: number): string }; result: unknown }[],
) {
  return options.reduce((max, o) => {
    const ship = (o.result as { shippingNetAmount?: string | null } | null)?.shippingNetAmount ?? null;
    const base = new MoneyDecimal(quotedBase({ netAmount: o.netAmount.toFixed(2), shippingNetAmount: ship }));
    return base.gt(max) ? base : max;
  }, new MoneyDecimal(0));
}

/** Whether a quote registers automatically: its largest base reaches the threshold (A-11). */
export function reachesThreshold(base: string, threshold: string): boolean {
  return new MoneyDecimal(base).gte(threshold);
}

/** The lock an order's quote carries: an accepted option first, else a live (registered / won) deal registration. */
export function lockOf(input: {
  acceptedOption: { ratePct: string } | null;
  registration: { status: string; lockedFirstRatePct: string; lockedRepeatRatePct: string } | null;
}): RateLock | null {
  if (input.acceptedOption)
    return {
      firstOrderPct: input.acceptedOption.ratePct,
      repeatOrderPct: input.acceptedOption.ratePct,
      source: 'accepted_option',
    };
  const r = input.registration;
  if (r && (r.status === 'registered' || r.status === 'won'))
    return {
      firstOrderPct: r.lockedFirstRatePct,
      repeatOrderPct: r.lockedRepeatRatePct,
      source: 'deal_registration',
    };
  return null;
}

/**
 * D-468 (Phase 3 item 4, PLAN A-11): deal registration — protection + rate lock, never a rate cut. Automatic when a
 * quote's commission base ≥ `agent.deal_registration_threshold` (500,000.00) or a call-off agreement is accepted from
 * an agent's quote; on the agent's request for smaller quotes (no approval). Protects for `agent.deal_protection_days`
 * (90): other agents and staff assignment are refused neutrally while it is active. Locks the standard rates in force
 * (or the accepted option's) for every order of its quotes — and every call-off of its agreement.
 */
@Injectable()
export class AgentDealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    readonly events: DomainEvents,
    readonly activity: ActivityLogService,
  ) {}

  /** Registers (or joins the lead's active registration) for an agent quote, in the caller's transaction. */
  async register(
    tx: Tx,
    agentQuoteId: bigint,
    origin: 'automatic' | 'requested',
    actor: Actor,
    extra: { callOffAgreementId?: bigint } = {},
  ): Promise<SalesAgentDealRegistration> {
    const aq = await tx.salesAgentQuote.findUniqueOrThrow({
      where: { id: agentQuoteId },
      include: { quote: { include: { options: true } }, agent: true, lead: true },
    });
    const now = new Date();
    const active = await tx.salesAgentDealRegistration.findFirst({
      where: { leadId: aq.leadId, status: 'registered' },
    });
    if (active) {
      if (aq.dealRegistrationId !== active.id)
        await tx.salesAgentQuote.update({ where: { id: aq.id }, data: { dealRegistrationId: active.id } });
      if (extra.callOffAgreementId && active.scope !== 'call_off_agreement')
        await tx.salesAgentDealRegistration.update({
          where: { id: active.id },
          data: {
            scope: 'call_off_agreement',
            callOffAgreementId: extra.callOffAgreementId,
            rowVersion: { increment: 1 },
          },
        });
      return tx.salesAgentDealRegistration.findUniqueOrThrow({ where: { id: active.id } });
    }
    const version = await planVersionAt(tx, aq.agent.planId, now);
    if (!version) throw new DomainException('agents.plan_not_in_force');
    const days = await this.settings.value('agent.deal_protection_days', now);
    const threshold = await this.settings.value('agent.deal_registration_threshold', now);
    const protectedUntil = new Date(now.getTime() + days * DAY_MS);
    const reg = await tx.salesAgentDealRegistration.create({
      data: {
        agentId: aq.agentId,
        leadId: aq.leadId,
        scope: extra.callOffAgreementId ? 'call_off_agreement' : 'quote',
        callOffAgreementId: extra.callOffAgreementId ?? null,
        origin,
        lockedFirstRatePct: version.firstOrderPct,
        lockedRepeatRatePct: version.repeatOrderPct,
        planVersionId: version.id,
        protectedUntil,
        thresholdSnapshot: {
          threshold,
          protectionDays: days,
          base: largestBase(aq.quote.options).toFixed(2),
          quoteId: aq.quote.publicId,
        } satisfies Prisma.InputJsonValue,
        registeredAt: now,
      },
    });
    await tx.salesAgentQuote.update({ where: { id: aq.id }, data: { dealRegistrationId: reg.id } });
    // The lead stays the agent's at least as long as the deal (D-417 protection extended, never shortened).
    if (aq.lead.status === 'registered' && aq.lead.protectedUntil < protectedUntil)
      await tx.salesAgentLead.update({
        where: { id: aq.leadId },
        data: { protectedUntil, rowVersion: { increment: 1 } },
      });
    await appendLeadActivity(tx, {
      leadId: aq.leadId,
      kind: 'system',
      data: { event: 'deal_registered', agentQuoteId: aq.publicId, origin },
      occurredAt: now,
    });
    await recordAgentEvent(this, tx, {
      type: 'sales_agent_deal.registered',
      aggregateType: 'sales_agent_deal_registration',
      aggregateId: reg.publicId,
      payload: {
        registrationId: reg.publicId,
        leadId: aq.lead.publicId,
        origin,
        protectedUntil: protectedUntil.toISOString(),
        lockedFirstRatePct: reg.lockedFirstRatePct.toString(),
        lockedRepeatRatePct: reg.lockedRepeatRatePct.toString(),
      },
      actor,
    });
    return reg;
  }

  /** After an agent quote is created: automatic when its base reaches the threshold. */
  async autoRegister(tx: Tx, agentQuoteId: bigint, actor: Actor): Promise<void> {
    const aq = await tx.salesAgentQuote.findUniqueOrThrow({
      where: { id: agentQuoteId },
      include: { quote: { include: { options: true } }, lead: true },
    });
    const threshold = await this.settings.value('agent.deal_registration_threshold', new Date());
    const active = await tx.salesAgentDealRegistration.findFirst({
      where: { leadId: aq.leadId, status: 'registered', agentId: aq.agentId },
    });
    if (active || reachesThreshold(largestBase(aq.quote.options).toFixed(2), threshold))
      await this.register(tx, agentQuoteId, 'automatic', actor);
  }

  /** The rates a live registration locked for an agent quote (null = none). */
  async lockFor(
    tx: Tx,
    agentQuoteId: bigint,
  ): Promise<{ firstOrderPct: string; repeatOrderPct: string } | null> {
    const aq = await tx.salesAgentQuote.findUnique({
      where: { id: agentQuoteId },
      include: { dealRegistration: true },
    });
    const lock = lockOf({
      acceptedOption: null,
      registration: aq?.dealRegistration
        ? {
            status: aq.dealRegistration.status,
            lockedFirstRatePct: aq.dealRegistration.lockedFirstRatePct.toString(),
            lockedRepeatRatePct: aq.dealRegistration.lockedRepeatRatePct.toString(),
          }
        : null,
    });
    return lock ? { firstOrderPct: lock.firstOrderPct, repeatOrderPct: lock.repeatOrderPct } : null;
  }

  /**
   * Commission accrual's lock for an order (fills `AgentCommissionsService.rateLockFor`): the order's quote — or, for
   * a call-off release, the agreement's quote — sent by THIS agent; its accepted option, else its registration.
   */
  async rateLockForOrder(tx: Tx, orderId: bigint, agentId: bigint): Promise<RateLock | null> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { quoteId: true, quote: { select: { source: true } } },
    });
    if (!order) return null;
    let quoteId = order.quoteId;
    if (order.quote.source === 'call_off') {
      const release = await tx.callOffRelease.findUnique({
        where: { quoteId },
        select: { agreement: { select: { quoteId: true } } },
      });
      if (release) quoteId = release.agreement.quoteId;
    }
    const aq = await tx.salesAgentQuote.findUnique({
      where: { quoteId },
      include: { dealRegistration: true },
    });
    if (!aq || aq.agentId !== agentId) return null;
    const accepted = await tx.salesAgentDiscountOption.findFirst({
      where: { status: 'accepted', request: { agentQuoteId: aq.id } },
      orderBy: { acceptedAt: 'desc' },
      select: { ratePct: true },
    });
    return lockOf({
      acceptedOption: accepted ? { ratePct: accepted.ratePct.toString() } : null,
      registration: aq.dealRegistration
        ? {
            status: aq.dealRegistration.status,
            lockedFirstRatePct: aq.dealRegistration.lockedFirstRatePct.toString(),
            lockedRepeatRatePct: aq.dealRegistration.lockedRepeatRatePct.toString(),
          }
        : null,
    });
  }

  /** The agent accepted an option: a registration of the quote takes its rate (and records it). */
  async optionAccepted(tx: Tx, agentQuoteId: bigint, optionId: bigint): Promise<void> {
    const aq = await tx.salesAgentQuote.findUniqueOrThrow({ where: { id: agentQuoteId } });
    if (!aq.dealRegistrationId) return;
    const option = await tx.salesAgentDiscountOption.findUniqueOrThrow({ where: { id: optionId } });
    await tx.salesAgentDealRegistration.update({
      where: { id: aq.dealRegistrationId },
      data: {
        approvedOptionId: option.id,
        lockedFirstRatePct: option.ratePct,
        lockedRepeatRatePct: option.ratePct,
        rowVersion: { increment: 1 },
      },
    });
  }

  /** Another agent's active registration on a lead with these contact keys (neutral refusal elsewhere). */
  async registeredElsewhere(
    db: Tx,
    agentId: bigint,
    or: Prisma.SalesAgentLeadWhereInput[],
    now = new Date(),
  ): Promise<boolean> {
    const row = await db.salesAgentDealRegistration.findFirst({
      where: {
        status: 'registered',
        protectedUntil: { gt: now },
        agentId: { not: agentId },
        lead: { OR: or },
      },
      select: { id: true },
    });
    return row !== null;
  }

  /** Staff assignment: a customer / company under another agent's active registration is refused. */
  async blocksAssignment(
    db: Tx,
    agentId: bigint,
    subject: { customerUserId: bigint } | { companyId: bigint },
    now = new Date(),
  ): Promise<boolean> {
    const lead: Prisma.SalesAgentLeadWhereInput =
      'customerUserId' in subject
        ? { convertedUserId: subject.customerUserId }
        : { convertedCompanyId: subject.companyId };
    const row = await db.salesAgentDealRegistration.findFirst({
      where: { status: 'registered', protectedUntil: { gt: now }, agentId: { not: agentId }, lead },
      select: { id: true },
    });
    return row !== null;
  }

  /** Ends the lead's active registration (won / lost) in the caller's transaction. */
  async endForLead(tx: Tx, leadId: bigint, status: 'won' | 'lost', actor: Actor): Promise<void> {
    const regs = await tx.salesAgentDealRegistration.findMany({ where: { leadId, status: 'registered' } });
    for (const reg of regs) {
      await tx.salesAgentDealRegistration.update({
        where: { id: reg.id },
        data: { status, endedAt: new Date(), endedReason: `lead_${status}`, rowVersion: { increment: 1 } },
      });
      await recordAgentEvent(this, tx, {
        type: `sales_agent_deal.${status}`,
        aggregateType: 'sales_agent_deal_registration',
        aggregateId: reg.publicId,
        payload: { registrationId: reg.publicId },
        actor,
      });
    }
  }

  /** Scheduled: registrations past their protection expire (the lock of orders already placed stays). */
  async expireDue(now = new Date()): Promise<number> {
    const due = await this.prisma.salesAgentDealRegistration.findMany({
      where: { status: 'registered', protectedUntil: { lte: now } },
      select: { id: true },
      take: 500,
    });
    let n = 0;
    for (const { id } of due)
      await this.prisma.withTx(async (tx) => {
        const { count } = await tx.salesAgentDealRegistration.updateMany({
          where: { id, status: 'registered' },
          data: { status: 'expired', endedAt: now, endedReason: 'protection_ended' },
        });
        if (count === 0) return;
        n += 1;
        const reg = await tx.salesAgentDealRegistration.findUniqueOrThrow({ where: { id } });
        await appendLeadActivity(tx, {
          leadId: reg.leadId,
          kind: 'system',
          data: { event: 'deal_ended', reason: 'expired' },
          occurredAt: now,
        });
        await recordAgentEvent(this, tx, {
          type: 'sales_agent_deal.expired',
          aggregateType: 'sales_agent_deal_registration',
          aggregateId: reg.publicId,
          payload: { registrationId: reg.publicId },
          actor: systemActor('agents.deal_expiry'),
        });
      });
    return n;
  }

  /** A call-off agreement accepted from an agent's quote keeps the lock for every call-off (A-11). */
  @OnDomainEvent('call_off.accepted', { consumer: 'agents.deal_call_off' })
  async onCallOffAccepted(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const quote = await tx.quote.findUnique({
      where: { publicId: String(event.payload['quoteId']) },
      select: { id: true },
    });
    const agreement = await tx.callOffAgreement.findUnique({ where: { publicId: event.aggregateId } });
    if (!quote || !agreement) return;
    const aq = await tx.salesAgentQuote.findUnique({ where: { quoteId: quote.id } });
    if (!aq) return;
    if (aq.dealRegistrationId) {
      const reg = await tx.salesAgentDealRegistration.findUniqueOrThrow({
        where: { id: aq.dealRegistrationId },
      });
      if (reg.status === 'registered' || reg.status === 'won') {
        await tx.salesAgentDealRegistration.update({
          where: { id: reg.id },
          data: {
            scope: 'call_off_agreement',
            callOffAgreementId: agreement.id,
            rowVersion: { increment: 1 },
          },
        });
        return;
      }
    }
    await this.register(tx, aq.id, 'automatic', systemActor('agents.deal_call_off'), {
      callOffAgreementId: agreement.id,
    });
  }
}
