import { formatMoney, MoneyDecimal } from '@common/money/money';
import { addCalendarDays, bangkokDate } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type SalesAgent } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { SettingsService } from '@platform/settings/settings.service';

import { commissionFor } from './agent-commission-rules';
import { AgentCommissionsService } from './agent-commissions.service';
import { AgentDealsService } from './agent-deals.service';
import { AgentPayoutProfilesService } from './agent-payout-profiles.service';
import { DAY_MS, planVersionAt } from './agent-shared';

export type ForecastStatus = 'in_progress' | 'pending' | 'held' | 'earned' | 'statemented' | 'paid';
export type WaitingFor =
  'completion' | 'claim_window' | 'payment' | 'review' | 'statement' | 'approval' | 'payout' | null;

/** The 1st of the month after a Bangkok date (YYYY-MM-DD). */
export function firstOfNextMonth(day: string): string {
  const [y, m] = day.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/**
 * D-468 (F47) with D-466 §5: when a commission is expected to be paid, from the system's own rules — an entry is
 * earned when the claim window has passed and the group is fully paid; statements are made on the 1st (Bangkok) for
 * what was earned up to the end of the previous month and, once Finance approves them (assumed on the 1st), a
 * freelance agent is paid within `agents.rules.paymentTermsDays`; an employee's statement goes to payroll on approval.
 * Not "the 5th" (P-02): the payment terms decide. Dates are Bangkok calendar days. Pure.
 */
export function expectedDates(input: {
  status: Exclude<ForecastStatus, 'in_progress'>;
  agentKind: 'freelance' | 'employee';
  availableAt: Date | null;
  earnedAt: Date | null;
  groupFullyPaid: boolean;
  statement: { status: string; periodEnd: Date; approvedAt: Date | null; paidAt: Date | null } | null;
  paymentTermsDays: number;
  now: Date;
}): {
  earnableOn: string | null;
  statementOn: string | null;
  expectedPayableOn: string | null;
  waitingFor: WaitingFor;
} {
  const terms = input.agentKind === 'freelance' ? input.paymentTermsDays : 0;
  const today = bangkokDate(input.now);
  const pay = (statementOn: string, waitingFor: WaitingFor) => ({
    statementOn,
    expectedPayableOn: addCalendarDays(statementOn, terms),
    waitingFor,
  });
  switch (input.status) {
    case 'paid': {
      const on = input.statement?.paidAt ? bangkokDate(input.statement.paidAt) : null;
      return { earnableOn: null, statementOn: null, expectedPayableOn: on, waitingFor: null };
    }
    case 'statemented': {
      const s = input.statement;
      if (s?.approvedAt) {
        const approved = bangkokDate(s.approvedAt);
        const due = addCalendarDays(approved, terms);
        return {
          earnableOn: null,
          statementOn: approved,
          expectedPayableOn: due < today ? today : due,
          waitingFor: 'payout',
        };
      }
      const made = s
        ? addCalendarDays(bangkokDate(new Date(s.periodEnd.getTime() + 12 * 3_600_000)), 1)
        : today;
      const statementOn = made < today ? today : made;
      return { earnableOn: null, ...pay(statementOn, 'approval') };
    }
    case 'earned': {
      const earned = input.earnedAt ? bangkokDate(input.earnedAt) : today;
      return { earnableOn: earned, ...pay(firstOfNextMonth(earned), 'statement') };
    }
    case 'pending': {
      const window = input.availableAt ? bangkokDate(input.availableAt) : today;
      const earnableOn = window < today ? today : window;
      return {
        earnableOn,
        ...pay(firstOfNextMonth(earnableOn), input.groupFullyPaid ? 'claim_window' : 'payment'),
      };
    }
    case 'held':
      return { earnableOn: null, statementOn: null, expectedPayableOn: null, waitingFor: 'review' };
  }
}

export interface ForecastItem {
  orderCode: string | null;
  status: ForecastStatus;
  isFirstOrder: boolean;
  expectedBase: string;
  ratePct: string;
  expectedCommission: string;
  earnableOn: string | null;
  statementOn: string | null;
  expectedPayableOn: string | null;
  waitingFor: WaitingFor;
}

const OPEN_INSTALMENTS = ['pending', 'due', 'overdue', 'partially_paid'] as const;
/** Paid entries shown for this long (technical bound of the view). */
const PAID_WINDOW_MS = 90 * DAY_MS;

/**
 * D-468 (Phase 3 item 7, F47): the agent's commission forecast per order — orders of their customers still in
 * progress (expected at the rate locked or in force) and every commission entry not yet paid (plus the last 90 days
 * paid), with the expected payable date from the system's real rules. Order code only — no other customer data.
 */
@Injectable()
export class AgentForecastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly commissions: AgentCommissionsService,
    private readonly deals: AgentDealsService,
    private readonly payoutProfiles: AgentPayoutProfilesService,
  ) {}

  async forecast(agent: SalesAgent, now = new Date()) {
    const rules = (await this.settings.at('agents.rules', { at: now })).value;
    const entries = await this.prisma.salesAgentCommission.findMany({
      where: {
        agentId: agent.id,
        kind: 'order',
        OR: [
          { status: { in: ['pending', 'held', 'earned', 'statemented'] } },
          { status: 'paid', updatedAt: { gte: new Date(now.getTime() - PAID_WINDOW_MS) } },
        ],
      },
      include: {
        order: { select: { orderCode: true } },
        statement: { select: { status: true, periodEnd: true, approvedAt: true, paidAt: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    const items: ForecastItem[] = [];
    for (const e of entries) {
      const unpaid =
        e.status === 'pending' && e.orderGroupId !== null
          ? await this.prisma.instalment.count({
              where: { schedule: { orderGroupId: e.orderGroupId }, status: { in: [...OPEN_INSTALMENTS] } },
            })
          : 0;
      const status = e.status as Exclude<ForecastStatus, 'in_progress'>;
      items.push({
        orderCode: e.order?.orderCode ?? null,
        status,
        isFirstOrder: e.isFirstOrder,
        expectedBase: e.baseAmount.toFixed(2),
        ratePct: e.ratePct?.toFixed(4) ?? '0.0000',
        expectedCommission: e.amount.toFixed(2),
        ...expectedDates({
          status,
          agentKind: agent.kind,
          availableAt: e.availableAt,
          earnedAt: e.earnedAt,
          groupFullyPaid: unpaid === 0,
          statement: e.statement,
          paymentTermsDays: rules.paymentTermsDays,
          now,
        }),
      });
    }
    items.unshift(...(await this.inProgress(agent, now)));
    const open = items.filter((i) => i.status !== 'paid');
    const total = open.reduce((a, i) => a.add(i.expectedCommission), new MoneyDecimal(0));
    return {
      asOf: now,
      paymentTermsDays: rules.paymentTermsDays,
      payoutProfileReady: await this.payoutProfiles.payoutReady(agent),
      totalExpected: total.toFixed(2),
      items,
    };
  }

  /** Orders of the agent's linked customers placed in the link window, not yet completed nor cancelled. */
  private async inProgress(agent: SalesAgent, now: Date): Promise<ForecastItem[]> {
    const links = await this.prisma.salesAgentLink.findMany({
      where: { agentId: agent.id, status: 'active', endsAt: { gt: new Date(now.getTime() - 365 * DAY_MS) } },
      select: {
        id: true,
        customerUserId: true,
        companyId: true,
        attributedAt: true,
        endsAt: true,
        _count: { select: { commissions: { where: { kind: 'order' } } } },
      },
    });
    const out: ForecastItem[] = [];
    for (const link of links) {
      const orders = await this.prisma.order.findMany({
        where: {
          status: { notIn: ['completed', 'cancelled'] },
          orderGroup: {
            status: { notIn: ['cancelled', 'pending_company_approval'] },
            placedAt: { gte: link.attributedAt, lt: link.endsAt },
            ...(link.companyId
              ? { companyId: link.companyId }
              : { companyId: null, customerUserId: link.customerUserId! }),
          },
          customerUserId: { not: agent.userId },
        },
        select: { id: true, orderCode: true, orderGroup: { select: { placedAt: true } } },
        orderBy: { orderGroup: { placedAt: 'asc' } },
        take: 100,
      });
      let first = link._count.commissions === 0;
      for (const o of orders) {
        const version = await planVersionAt(this.prisma, agent.planId, o.orderGroup.placedAt);
        if (!version) continue;
        const base = await this.commissions.base(this.prisma, o.id);
        const r = commissionFor({
          base: formatMoney(base),
          isFirstOrder: first,
          plan: {
            firstOrderPct: version.firstOrderPct.toString(),
            repeatOrderPct: version.repeatOrderPct.toString(),
          },
          lock: await this.deals.rateLockForOrder(this.prisma, o.id, agent.id),
          grossMargin: null,
          alertPct: '100',
        });
        const below = base.lte(0) || base.lt(version.minBaseAmount.toString());
        out.push({
          orderCode: o.orderCode,
          status: 'in_progress',
          isFirstOrder: first,
          expectedBase: formatMoney(base),
          ratePct: r.ratePct,
          expectedCommission: below ? '0.00' : r.amount,
          earnableOn: null,
          statementOn: null,
          expectedPayableOn: null,
          waitingFor: 'completion',
        });
        first = false;
      }
    }
    return out;
  }
}
