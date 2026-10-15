import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, type MoneyValue } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma, type SalesAgentCommission } from '@generated/prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

import { AGENT_REF_SELECT, D, DAY_MS, invalid, planVersionAt, recordAgentEvent, ZERO } from './agent-shared';

export const COMMISSION_INCLUDE = {
  agent: { select: AGENT_REF_SELECT },
  order: { select: { publicId: true, orderCode: true } },
  link: {
    select: {
      source: true,
      customerUser: { select: { displayName: true } },
      company: { select: { legalName: true, tradeName: true } },
    },
  },
  factoryLink: { select: { factory: { select: { legalName: true, tradeName: true } } } },
  statement: { select: { statementNo: true } },
} as const satisfies Prisma.SalesAgentCommissionInclude;
export type CommissionRow = Prisma.SalesAgentCommissionGetPayload<{ include: typeof COMMISSION_INCLUDE }>;

/** Instalment statuses that still leave something to pay (the loyalty credit rule, D-132). */
const OPEN_INSTALMENTS = ['pending', 'due', 'overdue', 'partially_paid'] as const;

/** Round half up to satang. */
const round = (v: MoneyValue) => v.toDecimalPlaces(2);

/**
 * The commission ledger (D-418, D-419): an entry when an attributed order completes — first or repeat
 * rate of the plan version in force when the group was placed, capped at the plan's share of the order's
 * margin — earned once the claim window has passed and the group is paid; refunds bring it down with a
 * reversal; a shared identity between agent and customer holds it for Sales. Factory bounties are earned
 * when a linked factory completes its qualifying jobs after activation. Staff add signed adjustments.
 */
@Injectable()
export class AgentCommissionsService {
  private readonly logger = new Logger(AgentCommissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    readonly events: DomainEvents,
    readonly activity: ActivityLogService,
  ) {}

  // --- accrual on completion -----------------------------------------------------------------------------

  @OnDomainEvent('order.fact_recorded', { consumer: 'agents.accrue' })
  async onFact(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const { orderId, fact } = event.payload as { orderId: string; fact: string };
    if (fact !== 'completed') return;
    const order = await tx.order.findUnique({ where: { publicId: orderId } });
    if (order) await this.accrue(tx, order.id);
  }

  /** The order's base: lines before VAT, no shipping, after discounts (the loyalty earning base, D-130). */
  async base(db: Tx, orderId: bigint): Promise<MoneyValue> {
    const lines = await db.orderLine.findMany({ where: { orderId, lineType: { not: 'shipping' } } });
    return lines.reduce((a, l) => a.add(D(l.netAmount).sub(l.discountAmount.toString())), ZERO());
  }

  async accrue(tx: Tx, orderId: bigint): Promise<SalesAgentCommission | null> {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { orderGroup: { select: { id: true, companyId: true, placedAt: true } } },
    });
    if (order.status !== 'completed') return null;
    if (await tx.salesAgentCommission.findFirst({ where: { orderId, kind: 'order' } })) return null;
    const placedAt = order.orderGroup.placedAt;
    // A company's orders follow the company's link; others the buyer's (D-417).
    const linkWhere = {
      status: 'active' as const,
      attributedAt: { lte: placedAt },
      endsAt: { gt: placedAt },
    };
    const link =
      (order.orderGroup.companyId
        ? await tx.salesAgentLink.findFirst({
            where: { companyId: order.orderGroup.companyId, ...linkWhere },
          })
        : null) ??
      (!order.orderGroup.companyId
        ? await tx.salesAgentLink.findFirst({ where: { customerUserId: order.customerUserId, ...linkWhere } })
        : null);
    if (!link) return null;
    const agent = await tx.salesAgent.findUniqueOrThrow({ where: { id: link.agentId } });
    if (agent.userId === order.customerUserId) return null; // never on the agent's own purchase
    const version = await planVersionAt(tx, agent.planId, placedAt);
    if (!version) return null;
    const base = await this.base(tx, orderId);
    if (base.lte(0) || base.lt(version.minBaseAmount.toString())) return null;
    const isFirstOrder =
      (await tx.salesAgentCommission.count({ where: { linkId: link.id, kind: 'order' } })) === 0;
    const rate = D(isFirstOrder ? version.firstOrderPct : version.repeatOrderPct);
    const byRate = round(base.mul(rate).div(100));
    const margin = order.marginAmount === null ? null : D(order.marginAmount);
    const cap =
      margin === null
        ? null
        : round(
            D(margin.gt(0) ? margin : 0)
              .mul(version.marginCapPct.toString())
              .div(100),
          );
    const amount = cap !== null && cap.lt(byRate) ? cap : byRate;
    const flags = await this.sharedIdentity(tx, agent.userId, order.customerUserId);
    const actor = systemActor('agents.accrue');
    const entry = await tx.salesAgentCommission.create({
      data: {
        agentId: agent.id,
        kind: 'order',
        status: flags.length ? 'held' : 'pending',
        linkId: link.id,
        orderId,
        orderGroupId: order.orderGroup.id,
        planVersionId: version.id,
        isFirstOrder,
        baseAmount: formatMoney(base),
        ratePct: rate.toFixed(4),
        marginAmount: margin === null ? null : formatMoney(margin),
        capAmount: cap === null ? null : formatMoney(cap),
        amount: formatMoney(amount),
        availableAt:
          order.claimWindowEndsAt ?? new Date((order.completedAt ?? new Date()).getTime() + 7 * DAY_MS),
        holdFlags: flags,
      },
    });
    await recordAgentEvent(this, tx, {
      type: flags.length ? 'sales_agent_commission.held' : 'sales_agent_commission.accrued',
      aggregateType: 'sales_agent_commission',
      aggregateId: entry.publicId,
      payload: {
        commissionId: entry.publicId,
        agentId: agent.publicId,
        orderId: order.publicId,
        amount: formatMoney(amount),
        flags,
      },
      actor,
    });
    return entry;
  }

  /** Phone, address, card or device shared by agent and customer (identity fingerprints, D-136, D-417). */
  private async sharedIdentity(tx: Tx, agentUserId: bigint, customerUserId: bigint): Promise<string[]> {
    const rows = await tx.$queryRaw<{ kind: string }[]>`
      SELECT DISTINCT a.kind::text AS kind
        FROM identity_fingerprints a
        JOIN identity_fingerprints c ON c.kind = a.kind AND c.value_hash = a.value_hash
       WHERE a.user_id = ${agentUserId} AND c.user_id = ${customerUserId}`;
    return rows.map((r) => `${r.kind}_match`).sort();
  }

  // --- earning ---------------------------------------------------------------------------------------------

  /** Scheduled: pending entries past the claim window whose group has nothing left to pay become earned. */
  async earnDue(now = new Date(), limit = 500): Promise<number> {
    const due = await this.prisma.salesAgentCommission.findMany({
      where: { status: 'pending', availableAt: { lte: now } },
      orderBy: { availableAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    let earned = 0;
    for (const { id } of due) {
      try {
        if (await this.prisma.withTx((tx) => this.earn(tx, id, now))) earned += 1;
      } catch (error) {
        this.logger.error(`commission ${id} not earned: ${(error as Error).message}`);
      }
    }
    return earned;
  }

  private async earn(tx: Tx, id: bigint, now: Date): Promise<boolean> {
    const entry = await tx.salesAgentCommission.findUniqueOrThrow({ where: { id } });
    if (entry.status !== 'pending') return false;
    if (entry.orderGroupId !== null) {
      const unpaid = await tx.instalment.count({
        where: { schedule: { orderGroupId: entry.orderGroupId }, status: { in: [...OPEN_INSTALMENTS] } },
      });
      if (unpaid > 0) return false;
    }
    await tx.salesAgentCommission.update({
      where: { id },
      data: { status: 'earned', earnedAt: now, rowVersion: { increment: 1 } },
    });
    await recordAgentEvent(this, tx, {
      type: 'sales_agent_commission.earned',
      aggregateType: 'sales_agent_commission',
      aggregateId: entry.publicId,
      payload: { commissionId: entry.publicId, amount: entry.amount.toFixed(2) },
      actor: systemActor('agents.earn'),
    });
    return true;
  }

  // --- refunds (D-418) --------------------------------------------------------------------------------------

  @OnDomainEvent('refund.succeeded', { consumer: 'agents.refund' })
  async onRefund(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const refund = await tx.refund.findUnique({
      where: { publicId: event.aggregateId },
      include: { payment: true },
    });
    if (!refund) return;
    const orderIds = refund.orderId
      ? [refund.orderId]
      : refund.payment.orderGroupId
        ? (
            await tx.order.findMany({
              where: { orderGroupId: refund.payment.orderGroupId },
              select: { id: true },
            })
          ).map((o) => o.id)
        : [];
    for (const orderId of orderIds) await this.reverseForOrder(tx, orderId, systemActor('agents.refund'));
  }

  /** Brings an order's commission down to what its refunded base still allows, with a negative entry. */
  async reverseForOrder(tx: Tx, orderId: bigint, actor: Actor): Promise<SalesAgentCommission | null> {
    const entry = await tx.salesAgentCommission.findFirst({
      where: { orderId, kind: 'order', status: { not: 'cancelled' } },
    });
    if (!entry || D(entry.amount).lte(0)) return null;
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const siblings = await tx.order.findMany({
      where: { orderGroupId: order.orderGroupId, status: { not: 'cancelled' } },
    });
    const groupGross = siblings.reduce((a, o) => a.add(o.grossAmount.toString()), ZERO());
    const refunds = await tx.refund.findMany({
      where: {
        status: 'succeeded',
        OR: [{ orderId }, { orderId: null, payment: { orderGroupId: order.orderGroupId } }],
      },
    });
    const refundedGross = refunds.reduce(
      (a, r) =>
        a.add(
          r.orderId === orderId
            ? D(r.amount)
            : groupGross.gt(0)
              ? D(r.amount).mul(order.grossAmount.toString()).div(groupGross)
              : ZERO(),
        ),
      ZERO(),
    );
    const gross = D(order.grossAmount);
    const share = gross.gt(0) ? MoneyMin(refundedGross.div(gross), D(1)) : D(0);
    const target = round(D(entry.amount).mul(D(1).sub(share)));
    const reversed = await tx.salesAgentCommission.aggregate({
      where: { reversesCommissionId: entry.id, kind: 'reversal' },
      _sum: { amount: true },
    });
    const current = D(entry.amount).add(D(reversed._sum.amount ?? ZERO()));
    const toReverse = current.sub(target);
    if (toReverse.lte(0)) return null;
    const now = new Date();
    const reversal = await tx.salesAgentCommission.create({
      data: {
        agentId: entry.agentId,
        kind: 'reversal',
        // Netted in the next statement (a pending original is simply earned smaller in total).
        status: 'earned',
        earnedAt: now,
        availableAt: now,
        linkId: entry.linkId,
        orderId: null,
        orderGroupId: entry.orderGroupId,
        reversesCommissionId: entry.id,
        amount: formatMoney(toReverse.neg()),
        note: 'refund',
      },
    });
    await recordAgentEvent(this, tx, {
      type: 'sales_agent_commission.reversed',
      aggregateType: 'sales_agent_commission',
      aggregateId: entry.publicId,
      payload: {
        commissionId: entry.publicId,
        reversalId: reversal.publicId,
        amount: formatMoney(toReverse),
      },
      actor,
    });
    return reversal;
  }

  // --- staff -----------------------------------------------------------------------------------------------

  /** A signed manual adjustment with a reason, earned at once (D-418). */
  async adjust(
    actor: UserActor,
    input: { agentId: string; amount: string; note: string },
  ): Promise<CommissionRow> {
    const amount = D(input.amount);
    if (amount.isZero()) invalid('amount', 'not zero', 'zero');
    const id = await this.prisma.withTx(async (tx) => {
      const agent = await tx.salesAgent.findUnique({ where: { publicId: input.agentId } });
      if (!agent) invalid('agentId', 'an agent', 'agent');
      const now = new Date();
      const entry = await tx.salesAgentCommission.create({
        data: {
          agentId: agent.id,
          kind: 'adjustment',
          status: 'earned',
          earnedAt: now,
          availableAt: now,
          amount: formatMoney(amount),
          note: input.note.trim(),
        },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'sales_agent_commission.adjust',
        actor,
        resourceType: 'sales_agent_commission',
        resourcePublicId: entry.publicId,
        data: { agentId: agent.publicId, amount: formatMoney(amount), note: input.note },
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_commission.adjusted',
        aggregateType: 'sales_agent_commission',
        aggregateId: entry.publicId,
        payload: { commissionId: entry.publicId, agentId: agent.publicId, amount: formatMoney(amount) },
        actor,
      });
      return entry.publicId;
    });
    return this.get(id);
  }

  /** Sales decide a held entry: release it to the normal path, or cancel it (D-417). */
  async decideHeld(
    actor: UserActor,
    publicId: string,
    input: { decision: 'release' | 'cancel'; reason: string },
  ): Promise<CommissionRow> {
    await this.prisma.withTx(async (tx) => {
      const entry = await tx.salesAgentCommission.findUnique({ where: { publicId } });
      if (!entry) throw new DomainException('http.not_found');
      if (entry.status !== 'held')
        throw new DomainException('agents.commission_not_held', { params: { status: entry.status } });
      await tx.salesAgentCommission.update({
        where: { id: entry.id },
        data: {
          status: input.decision === 'release' ? 'pending' : 'cancelled',
          note: `${input.decision}: ${input.reason.trim()}`,
          rowVersion: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        category: 'approval',
        action: `sales_agent_commission.${input.decision}`,
        actor,
        resourceType: 'sales_agent_commission',
        resourcePublicId: entry.publicId,
        data: { reason: input.reason, flags: entry.holdFlags },
      });
      await recordAgentEvent(this, tx, {
        type: `sales_agent_commission.${input.decision === 'release' ? 'released' : 'cancelled'}`,
        aggregateType: 'sales_agent_commission',
        aggregateId: entry.publicId,
        payload: { commissionId: entry.publicId, reason: input.reason },
        actor,
      });
    });
    return this.get(publicId);
  }

  async get(publicId: string, db: Tx = this.prisma): Promise<CommissionRow> {
    const row = await db.salesAgentCommission.findUnique({
      where: { publicId },
      include: COMMISSION_INCLUDE,
    });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  list(where: Prisma.SalesAgentCommissionWhereInput, page: number, perPage: number) {
    return Promise.all([
      this.prisma.salesAgentCommission.findMany({
        where,
        include: COMMISSION_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.salesAgentCommission.count({ where }),
    ]);
  }

  // --- factory bounty (D-419) ----------------------------------------------------------------------------

  /** Scheduled: pending factory links are qualified (bounty earned) or expired by the agent's plan. */
  async settleFactoryLinks(now = new Date()): Promise<number> {
    const links = await this.prisma.salesAgentFactoryLink.findMany({
      where: { status: 'pending' },
      select: { id: true },
      take: 500,
    });
    let changed = 0;
    for (const { id } of links) {
      try {
        if (await this.prisma.withTx((tx) => this.settleFactoryLink(tx, id, now))) changed += 1;
      } catch (error) {
        this.logger.error(`factory link ${id} not settled: ${(error as Error).message}`);
      }
    }
    return changed;
  }

  async qualifyingJobs(factoryId: bigint, from: Date, to: Date, db: Tx = this.prisma): Promise<number> {
    return db.productionJob.count({
      where: {
        factoryId,
        status: 'completed',
        reproductionOfJobId: null,
        claimId: null,
        actualFinishAt: { gte: from, lte: to },
      },
    });
  }

  private async settleFactoryLink(tx: Tx, id: bigint, now: Date): Promise<boolean> {
    const link = await tx.salesAgentFactoryLink.findUniqueOrThrow({
      where: { id },
      include: { factory: true, agent: true },
    });
    if (link.status !== 'pending' || !link.factory.activatedAt) return false;
    const version = await planVersionAt(tx, link.agent.planId, link.factory.activatedAt);
    const actor = systemActor('agents.factory_bounty');
    if (!version || D(version.factoryBountyAmount).lte(0)) {
      await tx.salesAgentFactoryLink.update({
        where: { id },
        data: { status: 'expired', closedAt: now, reason: 'no_bounty_in_plan' },
      });
      return true;
    }
    const windowEnd = new Date(link.factory.activatedAt.getTime() + version.factoryQualifyDays * DAY_MS);
    const jobs = await this.qualifyingJobs(
      link.factoryId,
      link.factory.activatedAt,
      windowEnd < now ? windowEnd : now,
      tx,
    );
    if (jobs >= version.factoryQualifyJobs) {
      await tx.salesAgentFactoryLink.update({
        where: { id },
        data: { status: 'qualified', qualifiedAt: now },
      });
      const entry = await tx.salesAgentCommission.create({
        data: {
          agentId: link.agentId,
          kind: 'factory_bounty',
          status: 'earned',
          earnedAt: now,
          availableAt: now,
          factoryLinkId: link.id,
          planVersionId: version.id,
          amount: version.factoryBountyAmount,
        },
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_commission.bounty_earned',
        aggregateType: 'sales_agent_commission',
        aggregateId: entry.publicId,
        payload: {
          commissionId: entry.publicId,
          factoryLinkId: link.publicId,
          amount: version.factoryBountyAmount.toFixed(2),
        },
        actor,
      });
      return true;
    }
    if (windowEnd <= now) {
      await tx.salesAgentFactoryLink.update({
        where: { id },
        data: { status: 'expired', closedAt: now, reason: 'qualifying_jobs_not_reached' },
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent_factory_link.expired',
        aggregateType: 'sales_agent_factory_link',
        aggregateId: link.publicId,
        payload: { factoryLinkId: link.publicId, jobs },
        actor,
      });
      return true;
    }
    return false;
  }
}

function MoneyMin(a: MoneyValue, b: MoneyValue): MoneyValue {
  return a.lt(b) ? a : b;
}
