import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { addCalendarDays, bangkokDate } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type DunningStage, type Prisma } from '@generated/prisma/client';
import { dateOnly, dayOf } from '@modules/ledger/ledger-dates';
import { PeriodsService } from '@modules/ledger/periods.service';
import { Injectable, Logger } from '@nestjs/common';
import { ApprovalsService } from '@platform/approvals/approvals.service';
import { AuditService } from '@platform/audit/audit.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { EntitiesService } from '@platform/entities/entities.service';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());
const ZERO = () => new MoneyDecimal(0);
const OPEN = ['open', 'partially_paid'] as const;
const DAY_MS = 86_400_000;

export const AGING_BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'over_90'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export function bucketOf(dueDate: string, asOf: string): AgingBucket {
  const days = Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / DAY_MS);
  if (days <= 0) return 'current';
  if (days <= 30) return 'd1_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'over_90';
}

export const ITEM_INCLUDE = {
  customer: { select: { publicId: true, displayName: true } },
  company: { select: { publicId: true, companyCode: true, legalName: true } },
  customerDocument: { select: { publicId: true, docNumber: true, docType: true, documentDate: true } },
  order: { select: { publicId: true, orderCode: true } },
  writeOffApproval: { select: { publicId: true, status: true } },
} as const satisfies Prisma.ReceivableItemInclude;
export type ItemRow = Prisma.ReceivableItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

/**
 * Customer AR (accounting-design §6): open items with aging, the company credit exposure B3.5 limits use,
 * reminders on receivables of individual customers (company credit instalments are reminded by B3.5,
 * D-122), the allowance for doubtful accounts (P30 — rates are a ⚖ setting, otherwise Finance enters the
 * amount) and write-offs under maker-checker (`write_off`, D-169, P30).
 */
@Injectable()
export class ReceivablesService {
  private readonly logger = new Logger(ReceivablesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly approvals: ApprovalsService,
    private readonly periods: PeriodsService,
    private readonly entities: EntitiesService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async items(where: Prisma.ReceivableItemWhereInput, page: number, perPage: number) {
    const [rows, total] = await Promise.all([
      this.prisma.receivableItem.findMany({
        where,
        include: ITEM_INCLUDE,
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.receivableItem.count({ where }),
    ]);
    return { rows, total };
  }

  async item(publicId: string, db: Tx = this.prisma): Promise<ItemRow> {
    const row = await db.receivableItem.findUnique({ where: { publicId }, include: ITEM_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  /** Open items bucketed by days past due at `asOf`, per customer / company (§6 aging). */
  async aging(asOf: string, companyId?: bigint) {
    const rows = await this.prisma.receivableItem.findMany({
      where: { status: { in: [...OPEN] }, createdAt: { lt: new Date(Date.parse(`${asOf}T00:00:00+07:00`) + DAY_MS) }, ...(companyId && { companyId }) },
      include: ITEM_INCLUDE,
    });
    const parties = new Map<string, { customer: ItemRow['customer']; company: ItemRow['company']; buckets: Record<AgingBucket, MoneyValue> }>();
    const totals = Object.fromEntries(AGING_BUCKETS.map((b) => [b, ZERO()])) as Record<AgingBucket, MoneyValue>;
    for (const row of rows) {
      const key = row.company?.publicId ?? row.customer.publicId;
      const party = parties.get(key) ?? {
        customer: row.customer,
        company: row.company,
        buckets: Object.fromEntries(AGING_BUCKETS.map((b) => [b, ZERO()])) as Record<AgingBucket, MoneyValue>,
      };
      const bucket = bucketOf(dayOf(row.dueDate), asOf);
      party.buckets[bucket] = party.buckets[bucket].add(row.openAmount.toString());
      totals[bucket] = totals[bucket].add(row.openAmount.toString());
      parties.set(key, party);
    }
    return { asOf, parties: [...parties.values()], totals };
  }

  /**
   * The credit a company uses (B3.5 limit check, D-121): its open receivables plus the open credit-term
   * instalments of orders not invoiced yet.
   */
  async companyExposure(db: Tx, companyId: bigint): Promise<MoneyValue> {
    const items = await db.receivableItem.aggregate({
      where: { companyId, status: { in: [...OPEN] } },
      _sum: { openAmount: true },
    });
    const pending = await db.instalment.findMany({
      where: {
        status: { in: ['pending', 'due', 'partially_paid', 'overdue'] },
        schedule: {
          orderGroup: { companyId, status: { not: 'cancelled' } },
          templateVersion: { template: { key: 'credit_term' } },
        },
      },
      include: { allocations: { include: { order: { select: { id: true, deliveredAt: true } } } } },
    });
    let uninvoiced = ZERO();
    for (const i of pending) {
      const open = D(i.cashAmount).sub(i.paidAmount.toString());
      const total = D(i.cashAmount);
      if (total.isZero()) continue;
      // The share of orders already invoiced is in the receivable items above.
      const notInvoiced = i.allocations.filter((a) => !a.order.deliveredAt).reduce((a, x) => a.add(x.cashAmount.toString()), ZERO());
      uninvoiced = uninvoiced.add(open.mul(notInvoiced).div(total));
    }
    return D(items._sum.openAmount?.toString() ?? '0').add(uninvoiced.toDecimalPlaces(2));
  }

  // --- dunning ------------------------------------------------------------------------------------------

  /**
   * Scheduled: reminders on the open receivables of individual customers — before the due date, on it and
   * once overdue — once per item and stage (§6). Company receivables are reminded per credit instalment by
   * B3.5 (D-122), so they are skipped here.
   */
  async dunning(now = new Date()): Promise<number> {
    const today = bangkokDate(now);
    const rules = (await this.settings.at('b2b.overdue_rules', { at: now })).value as { reminderDaysBeforeDue: number };
    const items = await this.prisma.receivableItem.findMany({
      where: { status: { in: [...OPEN] }, companyId: null, dueDate: { lte: dateOnly(addCalendarDays(today, rules.reminderDaysBeforeDue)) } },
      include: { dunningNotices: true, customer: { select: { publicId: true } }, customerDocument: true },
    });
    let sent = 0;
    for (const item of items) {
      const due = dayOf(item.dueDate);
      const stage: DunningStage = due > today ? 'before_due' : due === today ? 'on_due' : 'overdue';
      if (item.dunningNotices.some((n) => n.stage === stage)) continue;
      await this.prisma.withTx(async (tx) => {
        const event = await this.events.record(
          tx,
          {
            type: `receivable.${stage === 'before_due' ? 'due_soon' : stage === 'on_due' ? 'due_today' : 'overdue'}`,
            aggregateType: 'receivable_item',
            aggregateId: item.publicId,
            entityId: item.entityId,
            payload: {
              receivableItemId: item.publicId,
              customerId: item.customer.publicId,
              docNumber: item.customerDocument.docNumber,
              dueDate: due,
              openAmount: item.openAmount.toFixed(2),
            },
          },
          systemActor('receivables.dunning'),
        );
        await tx.dunningNotice.create({ data: { receivableItemId: item.id, stage, domainEventId: event.id } });
      });
      sent++;
    }
    return sent;
  }

  // --- allowance for doubtful accounts (P30) ------------------------------------------------------------

  /**
   * Updates the allowance to its target for the period: from `receivables.allowance_rates` (% of the open
   * balance per days-overdue band) when set, otherwise the amount Finance enters (method manual). Posts the
   * change against the allowance account (P30).
   */
  async provision(actor: UserActor, input: { asOf: string; amount?: string }) {
    const entityId = await this.entities.defaultEntityId();
    return this.prisma.withTx(async (tx) => {
      let rates: { fromDays: number; pct: string }[] | null = null;
      try {
        rates = (await this.settings.at('receivables.allowance_rates', { tx })).value;
      } catch (error) {
        if (!(error instanceof SettingNotFoundError)) throw error;
      }
      const basis: { band: number; open: string; pct: string }[] = [];
      let target: MoneyValue;
      if (input.amount !== undefined) target = D(input.amount);
      else if (rates && rates.length > 0) {
        const open = await tx.receivableItem.findMany({ where: { entityId, status: { in: [...OPEN] } } });
        const sorted = [...rates].sort((a, b) => b.fromDays - a.fromDays);
        target = ZERO();
        for (const item of open) {
          const days = Math.floor((Date.parse(`${input.asOf}T00:00:00Z`) - item.dueDate.getTime()) / DAY_MS);
          const band = sorted.find((r) => days >= r.fromDays);
          if (!band) continue;
          target = target.add(D(item.openAmount).mul(band.pct).div(100));
          basis.push({ band: band.fromDays, open: item.openAmount.toFixed(2), pct: band.pct });
        }
        target = target.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
      } else throw new DomainException('receivables.allowance_rates_unset');
      const allowance = await tx.account.findUniqueOrThrow({ where: { entityId_code: { entityId, code: '1219' } } });
      const sum = await tx.journalLine.aggregate({
        where: { accountId: allowance.id, journalEntry: { status: 'posted' } },
        _sum: { debit: true, credit: true },
      });
      const current = D(sum._sum.credit?.toString() ?? '0').sub(sum._sum.debit?.toString() ?? '0');
      const change = target.sub(current);
      const period = await this.periods.postingPeriod(tx, entityId, input.asOf);
      const row = await tx.badDebtProvision.create({
        data: {
          entityId,
          fiscalPeriodId: period.period.id,
          method: input.amount !== undefined ? 'manual' : 'aging_rates',
          targetAmount: formatMoney(target),
          amount: formatMoney(change),
          basis: basis,
          createdById: actor.userId,
        },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'bad_debt.provisioned',
        actor,
        resourceType: 'bad_debt_provision',
        resourcePublicId: row.publicId,
        entityId,
        data: { target: formatMoney(target), change: formatMoney(change) },
      });
      if (!change.isZero())
        await this.events.record(
          tx,
          {
            type: 'bad_debt.provisioned',
            aggregateType: 'bad_debt_provision',
            aggregateId: row.publicId,
            entityId,
            payload: {
              provisionId: row.publicId,
              periodLabel: input.asOf.slice(0, 7),
              provisionedOn: input.asOf,
              amount: formatMoney(change),
              target: formatMoney(target),
            },
          },
          actor,
        );
      return row;
    });
  }

  // --- write-off (maker-checker, P30) --------------------------------------------------------------------

  async requestWriteOff(actor: UserActor, publicId: string, reason: string) {
    await this.prisma.withTx(async (tx) => {
      const item = await tx.receivableItem.findUnique({ where: { publicId }, include: { customerDocument: true } });
      if (!item) throw new DomainException('http.not_found');
      if (!OPEN.includes(item.status as (typeof OPEN)[number]) || item.writeOffApprovalRequestId)
        throw new DomainException('receivables.nothing_to_write_off', { params: { status: item.status } });
      const request = await this.approvals.create(tx, {
        policyKey: 'write_off',
        subject: { type: 'receivable_item', id: item.id, publicId: item.publicId },
        requester: actor,
        amount: item.openAmount.toFixed(2),
        entityId: item.entityId,
        payload: { document: item.customerDocument.docNumber, openAmount: item.openAmount.toFixed(2), reason },
      });
      await tx.receivableItem.update({
        where: { id: item.id },
        data: { writeOffApprovalRequestId: request.id, writeOffReason: reason, rowVersion: { increment: 1 } },
      });
      await this.audit.record(tx, {
        category: 'finance',
        action: 'receivable_item.request',
        actor,
        resourceType: 'receivable_item',
        resourcePublicId: item.publicId,
        entityId: item.entityId,
        data: { openAmount: item.openAmount.toFixed(2), reason },
      });
    });
    return this.item(publicId);
  }

  @OnDomainEvent(['approval.approved', 'approval.rejected', 'approval.withdrawn', 'approval.expired'], {
    consumer: 'receivables.write_offs',
  })
  async onWriteOffDecision(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['policyKey'] !== 'write_off') return;
    const approval = await tx.approvalRequest.findUnique({ where: { publicId: event.aggregateId } });
    if (!approval) return;
    const item = await tx.receivableItem.findUnique({
      where: { id: approval.subjectId },
      include: { customerDocument: true, customer: true, company: true, order: true },
    });
    if (!item || item.writeOffApprovalRequestId !== approval.id || !OPEN.includes(item.status as (typeof OPEN)[number])) return;
    if (event.type !== 'approval.approved') {
      await tx.receivableItem.update({
        where: { id: item.id },
        data: { writeOffApprovalRequestId: null, writeOffReason: null, rowVersion: { increment: 1 } },
      });
      return;
    }
    const amount = item.openAmount.toFixed(2);
    await tx.receivableItem.update({
      where: { id: item.id },
      data: { status: 'written_off', openAmount: '0.00', writtenOffAt: new Date(), rowVersion: { increment: 1 } },
    });
    await this.events.record(
      tx,
      {
        type: 'receivable.written_off',
        aggregateType: 'receivable_item',
        aggregateId: item.publicId,
        entityId: item.entityId,
        payload: {
          receivableItemId: item.publicId,
          docNumber: item.customerDocument.docNumber,
          writtenOffOn: bangkokDate(new Date()),
          customerId: item.customer.publicId,
          companyId: item.company?.publicId ?? null,
          orderId: item.order?.publicId ?? null,
          amount,
          reason: item.writeOffReason,
        },
      },
      systemActor('receivables.write_offs'),
    );
  }

  static actor: Actor = systemActor('receivables');
}
