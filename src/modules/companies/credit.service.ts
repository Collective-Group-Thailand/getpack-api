import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { bangkokDate, startOfBangkokDay, startOfBangkokMonth } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Company, type CompanyCreditLimitVersion } from '@generated/prisma/client';
import {
  type CheckoutDraft,
  type CheckoutExtension,
  CheckoutExtensions,
  type CheckoutInput,
  type PlacedGroup,
} from '@modules/checkout/checkout.extensions';
import { type AgingBucket, ReceivablesService } from '@modules/receivables/receivables.service';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ApprovalsService } from '@platform/approvals/approvals.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { SettingsService } from '@platform/settings/settings.service';

import { CompaniesService } from './companies.service';

const POLICY = 'credit_limit';
const DAY_MS = 86_400_000;
const OPEN = ['pending', 'due', 'overdue', 'partially_paid'] as const;
const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());

export interface CreditView {
  creditStatus: string;
  limit: CompanyCreditLimitVersion | null;
  exposure: MoneyValue;
  available: MoneyValue;
  pending: CompanyCreditLimitVersion | null;
  eligibility: {
    paidOrdersCount: number;
    paidOrdersNeeded: number;
    eligible: boolean;
    financialStatementOnFile: boolean;
    allowedTermDays: number[];
    defaultTermDays: number;
  };
}

export interface ReceivablesView {
  asOf: string;
  open: MoneyValue;
  overdue: MoneyValue;
  aging: Record<AgingBucket, MoneyValue>;
  oldestOverdueDays: number | null;
  nextDueAt: Date | null;
  creditOrdersBlocked: boolean;
  notices: { code: string; groupCode: string | null; dueAt: Date | null; amount: MoneyValue | null }[];
}

function companyOf(input: CheckoutInput): string | null {
  return (input.extensions?.['company'] as { companyId?: string } | undefined)?.companyId ?? null;
}

/**
 * B2B credit (D-121, D-122). Companies start prepaid; after `b2b.credit_eligibility_paid_orders` paid
 * orders (or a verified financial statement) staff request a limit and term, approved through
 * `credit_limit` (Finance up to THB 100,000, C-Level above). Available credit = limit − open credit-term
 * instalments (interim credit exposure until B5 receivables). A credit order takes the `credit_term`
 * schedule with the company's term; reminders go out 7 days before and on the due date; more than 7
 * days overdue blocks new credit orders (prepaid still allowed) until paid.
 */
@Injectable()
export class CreditService {
  private readonly logger = new Logger(CreditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
    private readonly approvals: ApprovalsService,
    private readonly settings: SettingsService,
    private readonly events: DomainEvents,
    private readonly receivables: ReceivablesService,
  ) {}

  // --- reads --------------------------------------------------------------------------------------------

  async currentLimit(db: Tx, companyId: bigint, at = new Date()): Promise<CompanyCreditLimitVersion | null> {
    return db.companyCreditLimitVersion.findFirst({
      where: { creditLimit: { companyId }, status: 'approved', effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
    });
  }

  /**
   * The credit the company uses (D-121): its open receivables plus open credit-term instalments of orders not
   * invoiced yet — the receivables feed of B5.2 (it replaces the interim instalment sum of B3.5).
   */
  async exposure(db: Tx, companyId: bigint): Promise<MoneyValue> {
    return this.receivables.companyExposure(db, companyId);
  }

  async view(companyId: bigint, db: Tx = this.prisma): Promise<CreditView> {
    const company = await db.company.findUniqueOrThrow({
      where: { id: companyId },
      include: { kycDocuments: { where: { docType: 'financial_statement', status: { not: 'rejected' } } } },
    });
    const [limit, exposure, pending, needed, terms] = await Promise.all([
      this.currentLimit(db, companyId),
      this.exposure(db, companyId),
      db.companyCreditLimitVersion.findFirst({
        where: { creditLimit: { companyId }, status: 'proposed' },
        orderBy: { versionNo: 'desc' },
      }),
      this.settings.at('b2b.credit_eligibility_paid_orders'),
      this.settings.at('b2b.credit_terms'),
    ]);
    const available = MoneyDecimal.max(D(limit?.limitAmount ?? 0).sub(exposure), D(0));
    const { allowedDays, defaultDays } = terms.value as { allowedDays: number[]; defaultDays: number };
    return {
      creditStatus: company.creditStatus,
      limit,
      exposure,
      available,
      pending,
      eligibility: {
        paidOrdersCount: company.paidOrdersCount,
        paidOrdersNeeded: Number(needed.value),
        eligible:
          company.creditStatus !== 'prepaid' || company.kycDocuments.some((d) => d.status === 'verified'),
        financialStatementOnFile: company.kycDocuments.length > 0,
        allowedTermDays: allowedDays,
        defaultTermDays: defaultDays,
      },
    };
  }

  /**
   * What the company owes at `now` (D-122): its open receivables by days past due, the credit exposure, the next
   * due credit instalment and the notices of the dunning rules (due soon, due today, overdue, credit blocked).
   */
  async owed(companyId: bigint, now = new Date()): Promise<ReceivablesView> {
    const asOf = bangkokDate(now);
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const [aging, open, rules, instalments] = await Promise.all([
      this.receivables.aging(asOf, companyId),
      this.exposure(this.prisma, companyId),
      this.settings.at('b2b.overdue_rules', { at: now }),
      this.prisma.instalment.findMany({
        where: {
          status: { in: [...OPEN] },
          dueAt: { not: null },
          schedule: {
            orderGroup: { companyId, status: { not: 'cancelled' } },
            templateVersion: { template: { key: 'credit_term' } },
          },
        },
        include: { schedule: { include: { orderGroup: { select: { groupCode: true } } } } },
        orderBy: { dueAt: 'asc' },
      }),
    ]);
    const { reminderDaysBeforeDue } = rules.value as { reminderDaysBeforeDue: number };
    const today = startOfBangkokDay(asOf);
    const tomorrow = new Date(today.getTime() + DAY_MS);
    const soon = new Date(today.getTime() + (reminderDaysBeforeDue + 1) * DAY_MS);
    const notices: ReceivablesView['notices'] = [];
    let oldest: number | null = null;
    for (const i of instalments) {
      const due = i.dueAt!;
      const owed = D(i.cashAmount).sub(i.paidAmount.toString());
      const code = due < today ? 'overdue' : due < tomorrow ? 'due_today' : due < soon ? 'due_soon' : null;
      if (code)
        notices.push({ code, groupCode: i.schedule.orderGroup.groupCode, dueAt: due, amount: owed });
      if (due < today) {
        const days = Math.floor((today.getTime() - startOfBangkokDay(bangkokDate(due)).getTime()) / DAY_MS);
        oldest = Math.max(oldest ?? 0, days);
      }
    }
    for (const party of aging.parties)
      for (const bucket of ['d1_30', 'd31_60', 'd61_90', 'over_90'] as const)
        if (party.buckets[bucket].gt(0))
          oldest = Math.max(oldest ?? 0, { d1_30: 1, d31_60: 31, d61_90: 61, over_90: 91 }[bucket]);
    const blocked = company.creditStatus === 'blocked_overdue';
    if (blocked) notices.unshift({ code: 'credit_blocked', groupCode: null, dueAt: null, amount: null });
    const overdue = (['d1_30', 'd31_60', 'd61_90', 'over_90'] as const).reduce(
      (a, b) => a.add(aging.totals[b]),
      D(0),
    );
    return {
      asOf,
      open,
      overdue,
      aging: aging.totals,
      oldestOverdueDays: oldest,
      nextDueAt: instalments.find((i) => i.dueAt! >= today)?.dueAt ?? null,
      creditOrdersBlocked: blocked,
      notices,
    };
  }

  // --- eligibility (D-121) -------------------------------------------------------------------------

  /** The first paid order of a company group counts towards eligibility. */
  @OnDomainEvent('order.fact_recorded', { consumer: 'companies.credit_eligibility' })
  async onFact(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['fact'] !== 'paid_for_production') return;
    const order = await tx.order.findUnique({
      where: { publicId: String(event.payload['orderId']) },
      include: { orderGroup: true },
    });
    if (!order?.orderGroup.companyId) return;
    const paidInGroup = await tx.order.count({
      where: { orderGroupId: order.orderGroupId, paidForProductionAt: { not: null } },
    });
    if (paidInGroup !== 1) return;
    const company = await tx.company.update({
      where: { id: order.orderGroup.companyId },
      data: { paidOrdersCount: { increment: 1 } },
    });
    const needed = Number((await this.settings.at('b2b.credit_eligibility_paid_orders', { tx })).value);
    if (
      company.creditStatus === 'prepaid' &&
      company.status === 'active' &&
      company.paidOrdersCount >= needed
    ) {
      await tx.company.update({
        where: { id: company.id },
        data: { creditStatus: 'eligible', rowVersion: { increment: 1 } },
      });
      await this.companies.record(
        tx,
        company,
        'company.credit_eligible',
        { paidOrders: company.paidOrdersCount },
        systemActor('companies.credit'),
      );
    }
  }

  // --- limit requests (D-121) ---------------------------------------------------------------------------

  async requestLimit(
    actor: UserActor,
    companyPublicId: string,
    input: {
      limitAmount: string;
      termDays?: number;
      basis: 'paid_orders' | 'financial_statement';
      reason: string;
    },
    opts: { statementOnFile?: boolean } = {},
  ) {
    const terms = (await this.settings.at('b2b.credit_terms')).value as {
      allowedDays: number[];
      defaultDays: number;
    };
    const termDays = input.termDays ?? terms.defaultDays;
    if (!terms.allowedDays.includes(termDays))
      throw new DomainException('validation.failed', {
        errors: [{ path: 'termDays', code: 'in', message: `one of ${terms.allowedDays.join(', ')}` }],
      });
    return this.prisma.withTx(async (tx) => {
      const company = await this.companies.get(companyPublicId, tx);
      if (company.status !== 'active')
        throw new DomainException('companies.invalid_status', { params: { status: company.status } });
      if (input.basis === 'paid_orders' && company.creditStatus === 'prepaid')
        throw new DomainException('companies.credit_not_eligible');
      // Staff request on a verified statement; the Company Admin applies with one on file (Finance reviews it
      // within the approval, D-121).
      const statementOk = (d: { docType: string; status: string }) =>
        d.docType === 'financial_statement' &&
        (d.status === 'verified' || (opts.statementOnFile === true && d.status !== 'rejected'));
      if (input.basis === 'financial_statement' && !company.kycDocuments.some(statementOk))
        throw new DomainException('companies.credit_not_eligible');
      const identity =
        (await tx.companyCreditLimit.findUnique({ where: { companyId: company.id } })) ??
        (await tx.companyCreditLimit.create({ data: { companyId: company.id } }));
      if (
        await tx.companyCreditLimitVersion.findFirst({
          where: { creditLimitId: identity.id, status: 'proposed' },
        })
      )
        throw new DomainException('approval.already_pending');
      const last = await tx.companyCreditLimitVersion.findFirst({
        where: { creditLimitId: identity.id },
        orderBy: { versionNo: 'desc' },
      });
      const version = await tx.companyCreditLimitVersion.create({
        data: {
          creditLimitId: identity.id,
          versionNo: (last?.versionNo ?? 0) + 1,
          effectiveFrom: new Date(),
          status: 'proposed',
          limitAmount: input.limitAmount,
          termDays,
          eligibilityBasis: input.basis,
          reason: input.reason,
          createdById: actor.userId,
        },
      });
      const request = await this.approvals.create(tx, {
        policyKey: POLICY,
        subject: { type: 'company_credit_limit', id: version.id, publicId: version.publicId },
        requester: actor,
        amount: D(input.limitAmount).toFixed(2),
        payload: {
          companyId: company.publicId,
          companyName: company.legalName,
          limitAmount: D(input.limitAmount).toFixed(2),
          termDays,
          basis: input.basis,
          paidOrders: company.paidOrdersCount,
          reason: input.reason,
        },
      });
      await tx.companyCreditLimitVersion.update({
        where: { id: version.id },
        data: { approvalRequestId: request.id },
      });
      await this.companies.record(
        tx,
        company,
        'company.credit_limit_requested',
        {
          limitAmount: D(input.limitAmount).toFixed(2),
          termDays,
          approvalId: request.publicId,
        },
        actor,
      );
      return this.view(company.id, tx);
    });
  }

  @OnDomainEvent(['approval.approved', 'approval.rejected', 'approval.withdrawn', 'approval.expired'], {
    consumer: 'companies.credit_limit',
  })
  async onApprovalOutcome(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['policyKey'] !== POLICY) return;
    const request = await tx.approvalRequest.findUnique({ where: { publicId: event.aggregateId } });
    if (!request) return;
    const version = await tx.companyCreditLimitVersion.findFirst({
      where: { approvalRequestId: request.id, status: 'proposed' },
      include: { creditLimit: { include: { company: true } } },
    });
    if (!version) return;
    const company = version.creditLimit.company;
    const actor = systemActor('companies.credit_limit');
    const now = new Date();
    if (event.type !== 'approval.approved') {
      await tx.companyCreditLimitVersion.update({
        where: { id: version.id },
        data: { status: event.type === 'approval.rejected' ? 'rejected' : 'withdrawn', decidedAt: now },
      });
      await this.companies.record(
        tx,
        company,
        'company.credit_limit_rejected',
        { versionId: version.publicId },
        actor,
      );
      return;
    }
    await tx.companyCreditLimitVersion.update({
      where: { id: version.id },
      data: { status: 'approved', decidedAt: now, effectiveFrom: now },
    });
    const creditStatus =
      company.creditStatus === 'blocked_overdue'
        ? 'blocked_overdue'
        : D(version.limitAmount).gt(0)
          ? 'credit'
          : 'eligible';
    await tx.company.update({
      where: { id: company.id },
      data: { creditStatus, rowVersion: { increment: 1 } },
    });
    await this.companies.record(
      tx,
      company,
      'company.credit_limit_approved',
      {
        limitAmount: version.limitAmount.toFixed(2),
        termDays: version.termDays,
        creditStatus,
      },
      actor,
    );
  }

  // --- overdue and reminders (D-122) ----------------------------------------------------------------

  /**
   * Scheduled: reminders 7 days before and on the due date of credit-term instalments (once each), and
   * the overdue block — any instalment more than 7 days overdue blocks credit orders; paying releases it.
   */
  async runDunning(now = new Date()): Promise<{ reminders: number; blocked: number; released: number }> {
    const rules = (await this.settings.at('b2b.overdue_rules', { at: now })).value as {
      reminderDaysBeforeDue: number;
      blockCreditOrdersAfterDaysOverdue: number;
    };
    const today = startOfBangkokDay(new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10));
    const windows: [string, Date, Date][] = [
      [
        'company.credit_due_soon',
        new Date(today.getTime() + rules.reminderDaysBeforeDue * DAY_MS),
        new Date(today.getTime() + (rules.reminderDaysBeforeDue + 1) * DAY_MS),
      ],
      ['company.credit_due_today', today, new Date(today.getTime() + DAY_MS)],
    ];
    let reminders = 0;
    for (const [type, from, to] of windows) {
      const due = await this.prisma.instalment.findMany({
        where: {
          status: { in: [...OPEN] },
          dueAt: { gte: from, lt: to },
          schedule: {
            orderGroup: { companyId: { not: null }, status: { not: 'cancelled' } },
            templateVersion: { template: { key: 'credit_term' } },
          },
        },
        include: { schedule: { include: { orderGroup: { include: { company: true } } } } },
      });
      for (const i of due) {
        const already = await this.prisma.domainEvent.count({
          where: {
            type,
            aggregateId: i.schedule.orderGroup.company!.publicId,
            payload: { path: ['instalmentId'], equals: i.publicId },
          },
        });
        if (already > 0) continue;
        await this.prisma.withTx((tx) =>
          this.companies.record(
            tx,
            i.schedule.orderGroup.company!,
            type,
            {
              instalmentId: i.publicId,
              groupId: i.schedule.orderGroup.publicId,
              groupCode: i.schedule.orderGroup.groupCode,
              dueAt: i.dueAt!.toISOString(),
              amount: formatMoney(D(i.cashAmount).sub(i.paidAmount.toString())),
            },
            systemActor('companies.dunning'),
          ),
        );
        reminders += 1;
      }
    }
    const cutoff = new Date(now.getTime() - rules.blockCreditOrdersAfterDaysOverdue * DAY_MS);
    const late = await this.prisma.company.findMany({
      where: {
        creditStatus: 'credit',
        orderGroups: {
          some: {
            status: { not: 'cancelled' },
            paymentSchedule: { instalments: { some: { status: { in: [...OPEN] }, dueAt: { lt: cutoff } } } },
          },
        },
      },
    });
    for (const c of late)
      await this.setCreditStatus(c, 'blocked_overdue', {
        daysOverdue: rules.blockCreditOrdersAfterDaysOverdue,
      });
    const blocked = await this.prisma.company.findMany({ where: { creditStatus: 'blocked_overdue' } });
    let released = 0;
    for (const c of blocked) {
      const stillLate = await this.prisma.instalment.count({
        where: {
          status: { in: [...OPEN] },
          dueAt: { lt: cutoff },
          schedule: { orderGroup: { companyId: c.id, status: { not: 'cancelled' } } },
        },
      });
      if (stillLate === 0) {
        await this.setCreditStatus(c, 'credit', {});
        released += 1;
      }
    }
    return { reminders, blocked: late.length, released };
  }

  private async setCreditStatus(
    company: Company,
    to: 'credit' | 'blocked_overdue',
    data: Record<string, unknown>,
  ) {
    await this.prisma.withTx(async (tx) => {
      const { count } = await tx.company.updateMany({
        where: { id: company.id, creditStatus: company.creditStatus },
        data: { creditStatus: to, rowVersion: { increment: 1 } },
      });
      if (count === 0) return;
      await this.companies.record(
        tx,
        company,
        to === 'blocked_overdue' ? 'company.credit_blocked' : 'company.credit_released',
        data,
        systemActor('companies.dunning'),
      );
    });
  }

  // --- monthly statement data (D-125) --------------------------------------------------------------

  /** Order groups of the month (Bangkok) with what is paid and still open, and the open balance at its end. */
  async statement(companyId: bigint, month: string) {
    const from = startOfBangkokMonth(new Date(`${month}-15T00:00:00+07:00`));
    const to = startOfBangkokMonth(new Date(from.getTime() + 40 * DAY_MS));
    const groups = await this.prisma.orderGroup.findMany({
      where: {
        companyId,
        placedAt: { gte: from, lt: to },
        status: { notIn: ['cancelled', 'pending_company_approval'] },
      },
      include: { paymentSchedule: { include: { instalments: true } }, companyBranch: true },
      orderBy: { placedAt: 'asc' },
    });
    const lines = groups.map((g) => {
      const live = g.paymentSchedule?.instalments.filter((i) => i.status !== 'cancelled') ?? [];
      const paid = live.reduce((a, i) => a.add(i.paidAmount.toString()), D(0));
      const open = live
        .filter((i) => (OPEN as readonly string[]).includes(i.status))
        .reduce((a, i) => a.add(D(i.cashAmount).sub(i.paidAmount.toString())), D(0));
      const due =
        live
          .map((i) => i.dueAt)
          .filter((d): d is Date => d !== null)
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      return { group: g, gross: D(g.grossAmount), cash: D(g.cashAmount), paid, open, dueAt: due };
    });
    const openAtEnd = await this.prisma.instalment.findMany({
      where: {
        status: { in: [...OPEN] },
        schedule: { orderGroup: { companyId, placedAt: { lt: to }, status: { not: 'cancelled' } } },
      },
      select: { cashAmount: true, paidAmount: true },
    });
    return {
      from,
      to,
      lines,
      totalGross: lines.reduce((a, l) => a.add(l.gross), D(0)),
      totalPaid: lines.reduce((a, l) => a.add(l.paid), D(0)),
      openBalance: openAtEnd.reduce((a, i) => a.add(D(i.cashAmount).sub(i.paidAmount.toString())), D(0)),
    };
  }

  /** Scheduled on the 1st: `company.statement_ready` for last month, once per company with orders. */
  async statementsReady(now = new Date()): Promise<number> {
    const thisMonth = startOfBangkokMonth(now);
    const lastMonth = startOfBangkokMonth(new Date(thisMonth.getTime() - DAY_MS));
    const month = new Date(lastMonth.getTime() + 7 * 3_600_000).toISOString().slice(0, 7);
    const companies = await this.prisma.company.findMany({
      where: {
        status: { in: ['active', 'suspended'] },
        orderGroups: { some: { placedAt: { gte: lastMonth, lt: thisMonth } } },
      },
    });
    let sent = 0;
    for (const c of companies) {
      const already = await this.prisma.domainEvent.count({
        where: {
          type: 'company.statement_ready',
          aggregateId: c.publicId,
          payload: { path: ['month'], equals: month },
        },
      });
      if (already > 0) continue;
      await this.prisma.withTx((tx) =>
        this.companies.record(
          tx,
          c,
          'company.statement_ready',
          { month },
          systemActor('companies.statements'),
        ),
      );
      sent += 1;
    }
    return sent;
  }
}

/**
 * Checkout extension `company_credit` (order 850, before the schedule): a company order is a credit order
 * when the company has credit, is not blocked for overdue payments and the order fits its available
 * credit (D-121, D-122); otherwise it is prepaid and the customer is told why.
 */
@Injectable()
export class CreditCheckout implements CheckoutExtension, OnModuleInit {
  readonly key = 'company_credit';
  readonly order = 850;

  constructor(
    private readonly extensions: CheckoutExtensions,
    private readonly credit: CreditService,
  ) {}

  onModuleInit(): void {
    this.extensions.register(this);
    this.extensions.register(new CreditTermsExtension(this.credit));
  }

  async adjust(draft: CheckoutDraft, db: Tx): Promise<void> {
    const companyPublicId = companyOf(draft.input);
    if (!companyPublicId) return;
    const company = await db.company.findUnique({ where: { publicId: companyPublicId } });
    if (!company || company.creditStatus === 'prepaid' || company.creditStatus === 'eligible') return;
    if (company.creditStatus === 'blocked_overdue') {
      draft.notices.push({ code: 'company.credit_unavailable', params: { reason: 'blocked_overdue' } });
      return;
    }
    const view = await this.credit.view(company.id, db);
    if (!view.limit) return;
    if (view.available.lt(draft.totals.cashAmount)) {
      draft.notices.push({
        code: 'company.credit_unavailable',
        params: { reason: 'insufficient', available: formatMoney(view.available) },
      });
      return;
    }
    draft.state['creditApproved'] = true;
    draft.state['creditTermDays'] = view.limit.termDays;
    draft.notices.push({
      code: 'company.credit_order',
      params: { termDays: view.limit.termDays, available: formatMoney(view.available) },
    });
  }
}

/** Runs after the schedule (order 960): the credit-term instalment is due the company's term after delivery. */
class CreditTermsExtension implements CheckoutExtension {
  readonly key = 'company_credit_terms';
  readonly order = 960;

  constructor(private readonly credit: CreditService) {}

  async placed(tx: Tx, draft: CheckoutDraft, placed: PlacedGroup): Promise<void> {
    const days = draft.state['creditTermDays'];
    if (draft.state['creditApproved'] !== true || typeof days !== 'number') return;
    await tx.instalment.updateMany({
      where: { schedule: { orderGroupId: placed.groupId }, dueTrigger: 'days_after_delivery' },
      data: { dueOffsetDays: days },
    });
  }
}

export type StatementData = Awaited<ReturnType<CreditService['statement']>>;
export type { Actor };
