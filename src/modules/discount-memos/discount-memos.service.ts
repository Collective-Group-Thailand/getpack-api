import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type DiscountMemo, type Prisma } from '@generated/prisma/client';
import { CheckoutService } from '@modules/checkout/checkout.service';
import { CompaniesService } from '@modules/companies/companies.service';
import { CustomersService } from '@modules/customers/customers.service';
import { Injectable, Logger } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { ApprovalsService } from '@platform/approvals/approvals.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { EntitiesService } from '@platform/entities/entities.service';
import { SettingsService } from '@platform/settings/settings.service';

const POLICY = 'discount_memo';
const DAY_MS = 86_400_000;
const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());

export const MEMO_INCLUDE = {
  requestedBy: { select: { publicId: true, displayName: true } },
  customer: { select: { publicId: true, displayName: true } },
  company: { select: { publicId: true, legalName: true } },
  approvalRequest: { select: { publicId: true, status: true } },
  appliedOrderGroup: { select: { publicId: true, groupCode: true } },
} as const satisfies Prisma.DiscountMemoInclude;
export type MemoRow = Prisma.DiscountMemoGetPayload<{ include: typeof MEMO_INCLUDE }>;

export interface MemoInput {
  customerId?: string;
  companyId?: string;
  requestedPct: string;
  reason: string;
  evidenceFileIds?: string[];
}

/** Resulting margin % after a discount, or null when the buy cost is unknown. */
export function marginAfter(payable: MoneyValue, cost: MoneyValue | null, discount: MoneyValue): MoneyValue | null {
  if (cost === null) return null;
  const after = payable.sub(discount);
  if (after.lte(0)) return D(-100);
  return after.sub(cost).div(after).mul(100);
}

/**
 * Discount memos (D-052, D-124, D-162). CS may give up to `discounts.cs_limit_pct` on their own at
 * checkout; above that they raise a memo — reason, customer, order value (the customer's CS cart priced
 * now), requested %, resulting margin, evidence — routed by `discount_memo` to the matching tier only
 * (Director / VP / C-Level; below the margin floor always C-Level). An order memo is valid until the
 * cart's price lock (the quote validity) and applied once at checkout with its id on the discount; a
 * company memo sets the company discount (D-124), never below the floor.
 */
@Injectable()
export class DiscountMemosService {
  private readonly logger = new Logger(DiscountMemosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly checkout: CheckoutService,
    private readonly customers: CustomersService,
    private readonly companies: CompaniesService,
    private readonly approvals: ApprovalsService,
    private readonly settings: SettingsService,
    private readonly entities: EntitiesService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
  ) {}

  async get(publicId: string, db: Tx = this.prisma): Promise<MemoRow> {
    const row = await db.discountMemo.findUnique({ where: { publicId }, include: MEMO_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  list(where: Prisma.DiscountMemoWhereInput, page: number, perPage: number) {
    return Promise.all([
      this.prisma.discountMemo.findMany({ where, include: MEMO_INCLUDE, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
      this.prisma.discountMemo.count({ where }),
    ]);
  }

  // --- raise ------------------------------------------------------------------------------------------

  /** An order memo on the customer's CS cart. */
  async raiseForOrder(actor: UserActor, input: MemoInput): Promise<MemoRow> {
    if (!input.customerId) throw new DomainException('validation.failed', { errors: [{ path: 'customerId', code: 'required', message: 'required' }] });
    await this.assertAboveCsLimit(input.requestedPct);
    const customerUserId = await this.customers.customerIdOf(input.customerId);
    // Price the customer's CS cart as checkout would (promotions and points included, no memo yet).
    const draft = await this.checkout.price({ actor, customerUserId, channel: 'cs', csUserId: actor.userId }, {});
    const cart = await this.prisma.cart.findUniqueOrThrow({ where: { id: draft.cartId }, include: { items: true } });
    const base = draft.orders.reduce(
      (a, o) => a.add(o.lines.filter((l) => l.lineType !== 'shipping').reduce((b, l) => b.add(D(l.netAmount).sub(l.discountAmount)), D(0))),
      D(0),
    );
    const payable = draft.orders.reduce((a, o) => a.add(D(o.totals.netAmount).sub(o.totals.discountAmount)), D(0));
    const cost = draft.orders.every((o) => o.buyCostNet !== null) ? draft.orders.reduce((a, o) => a.add(o.buyCostNet!), D(0)) : null;
    const amount = base.mul(input.requestedPct).div(100).toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
    const margin = marginAfter(payable, cost, amount);
    const floor = D(String((await this.settings.at('pricing.margin_floor_pct')).value));
    const validUntil = new Date(Math.min(...cart.items.map((i) => i.priceLockedUntil.getTime())));
    if (validUntil <= new Date()) throw new DomainException('checkout.price_expired');
    return this.create(actor, {
      scope: 'order',
      customerUserId,
      companyId: null,
      cartId: cart.id,
      quoteId: cart.items[0]?.quoteId ?? null,
      orderValue: draft.totals.grossAmount,
      requestedPct: input.requestedPct,
      requestedAmount: formatMoney(amount),
      resultingMarginPct: margin,
      belowMarginFloor: margin === null || margin.lt(floor),
      reason: input.reason,
      evidenceFileIds: input.evidenceFileIds ?? [],
      validUntil,
    });
  }

  /** A company memo (D-124): the company discount % once approved. */
  async raiseForCompany(actor: UserActor, companyPublicId: string, input: MemoInput): Promise<MemoRow> {
    await this.assertAboveCsLimit(input.requestedPct);
    const company = await this.companies.get(companyPublicId);
    if (company.status !== 'active') throw new DomainException('companies.invalid_status', { params: { status: company.status } });
    const days = Number((await this.settings.at('quotes.validity_days')).value);
    return this.create(actor, {
      scope: 'company',
      customerUserId: null,
      companyId: company.id,
      cartId: null,
      quoteId: null,
      orderValue: '0.00',
      requestedPct: input.requestedPct,
      requestedAmount: '0.00',
      resultingMarginPct: null,
      // A company discount can never go below the floor (D-124): checkout caps it, so it is not flagged.
      belowMarginFloor: false,
      reason: input.reason,
      evidenceFileIds: input.evidenceFileIds ?? [],
      validUntil: new Date(Date.now() + days * DAY_MS),
    });
  }

  private async assertAboveCsLimit(pct: string) {
    const limit = String((await this.settings.at('discounts.cs_limit_pct')).value);
    if (D(pct).lte(limit)) throw new DomainException('discount_memos.within_cs_limit', { params: { limit } });
  }

  private async create(
    actor: UserActor,
    m: {
      scope: 'order' | 'company';
      customerUserId: bigint | null;
      companyId: bigint | null;
      cartId: bigint | null;
      quoteId: bigint | null;
      orderValue: string;
      requestedPct: string;
      requestedAmount: string;
      resultingMarginPct: MoneyValue | null;
      belowMarginFloor: boolean;
      reason: string;
      evidenceFileIds: string[];
      validUntil: Date;
    },
  ): Promise<MemoRow> {
    return this.prisma.withTx(async (tx) => {
      const files = m.evidenceFileIds.length
        ? await tx.fileObject.findMany({ where: { publicId: { in: m.evidenceFileIds }, ownerUserId: actor.userId, uploadStatus: 'uploaded' } })
        : [];
      if (files.length !== new Set(m.evidenceFileIds).size)
        throw new DomainException('validation.failed', { errors: [{ path: 'evidenceFileIds', code: 'fileReady', message: 'not uploaded files of yours' }] });
      const memo = await tx.discountMemo.create({
        data: {
          entityId: await this.entities.defaultEntityId(),
          scope: m.scope,
          requestedById: actor.userId,
          customerUserId: m.customerUserId,
          companyId: m.companyId,
          cartId: m.cartId,
          quoteId: m.quoteId,
          orderValue: m.orderValue,
          requestedPct: D(m.requestedPct).toFixed(4),
          requestedAmount: m.requestedAmount,
          resultingMarginPct: m.resultingMarginPct?.toDecimalPlaces(4).toFixed(4) ?? null,
          belowMarginFloor: m.belowMarginFloor,
          reason: m.reason,
          evidenceFileIds: files.map((f) => f.id),
          validUntil: m.validUntil,
        },
      });
      const request = await this.approvals.create(tx, {
        policyKey: POLICY,
        subject: { type: 'discount_memo', id: memo.id, publicId: memo.publicId },
        requester: actor,
        pct: D(m.requestedPct).toFixed(4),
        amount: m.requestedAmount,
        flags: m.belowMarginFloor ? ['below_margin_floor'] : [],
        expiresAt: m.validUntil,
        // Approvers see the request, not factory costs (D-141); the memo keeps the resulting margin.
        payload: {
          memoId: memo.publicId,
          scope: m.scope,
          orderValue: m.orderValue,
          requestedPct: D(m.requestedPct).toFixed(4),
          requestedAmount: m.requestedAmount,
          belowMarginFloor: m.belowMarginFloor,
          reason: m.reason,
        },
      });
      await tx.discountMemo.update({ where: { id: memo.id }, data: { approvalRequestId: request.id } });
      await this.record(tx, memo, 'discount_memo.requested', { pct: D(m.requestedPct).toFixed(4), scope: m.scope, approvalId: request.publicId }, actor);
      return this.get(memo.publicId, tx);
    });
  }

  async withdraw(actor: UserActor, publicId: string): Promise<MemoRow> {
    const memo = await this.get(publicId);
    if (memo.requestedById !== actor.userId) throw new DomainException('auth.forbidden');
    if (memo.status !== 'pending_approval' || !memo.approvalRequest) throw new DomainException('discount_memos.not_usable', { params: { status: memo.status } });
    await this.approvals.withdraw(actor, memo.approvalRequest.publicId, 'withdrawn by the requester');
    return this.prisma.withTx(async (tx) => {
      const current = await tx.discountMemo.findUniqueOrThrow({ where: { id: memo.id } });
      if (current.status === 'pending_approval') {
        await tx.discountMemo.update({ where: { id: memo.id }, data: { status: 'withdrawn', rowVersion: { increment: 1 } } });
        await this.record(tx, current, 'discount_memo.withdrawn', {}, actor);
      }
      return this.get(publicId, tx);
    });
  }

  // --- decisions ----------------------------------------------------------------------------------------

  @OnDomainEvent(['approval.approved', 'approval.rejected', 'approval.withdrawn', 'approval.expired'], { consumer: 'discount_memos.decision' })
  async onApprovalOutcome(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['policyKey'] !== POLICY) return;
    const request = await tx.approvalRequest.findUnique({ where: { publicId: event.aggregateId } });
    if (!request) return;
    const memo = await tx.discountMemo.findFirst({ where: { approvalRequestId: request.id, status: 'pending_approval' } });
    if (!memo) return;
    const actor = systemActor('discount_memos.decision');
    const now = new Date();
    if (event.type !== 'approval.approved') {
      const status = event.type === 'approval.rejected' ? 'rejected' : event.type === 'approval.expired' ? 'expired' : 'withdrawn';
      await tx.discountMemo.update({ where: { id: memo.id }, data: { status, decidedAt: status === 'rejected' ? now : null, rowVersion: { increment: 1 } } });
      await this.record(tx, memo, `discount_memo.${status}`, {}, actor);
      return;
    }
    if (memo.scope === 'company') {
      // D-124: the company discount is a new approved version, in force from now.
      const identity =
        (await tx.companyDiscount.findUnique({ where: { companyId: memo.companyId! } })) ??
        (await tx.companyDiscount.create({ data: { companyId: memo.companyId! } }));
      const last = await tx.companyDiscountVersion.findFirst({ where: { discountId: identity.id }, orderBy: { versionNo: 'desc' } });
      await tx.companyDiscountVersion.create({
        data: { discountId: identity.id, versionNo: (last?.versionNo ?? 0) + 1, effectiveFrom: now, status: 'approved', discountPct: memo.requestedPct, discountMemoId: memo.id },
      });
      const row = await tx.discountMemo.update({
        where: { id: memo.id },
        data: { status: 'applied', approvedPct: memo.requestedPct, decidedAt: now, appliedAt: now, rowVersion: { increment: 1 } },
      });
      await this.record(tx, row, 'discount_memo.approved', { scope: 'company', pct: memo.requestedPct.toFixed(4) }, actor);
      return;
    }
    const row = await tx.discountMemo.update({
      where: { id: memo.id },
      data: { status: 'approved', approvedPct: memo.requestedPct, decidedAt: now, rowVersion: { increment: 1 } },
    });
    await this.record(tx, row, 'discount_memo.approved', { scope: 'order', pct: memo.requestedPct.toFixed(4) }, actor);
  }

  /** Scheduled: approved order memos past their validity expire unused (D-052). */
  async expireUnused(now = new Date()): Promise<number> {
    const due = await this.prisma.discountMemo.findMany({ where: { status: 'approved', validUntil: { lte: now } } });
    for (const memo of due) {
      await this.prisma.withTx(async (tx) => {
        const { count } = await tx.discountMemo.updateMany({ where: { id: memo.id, status: 'approved' }, data: { status: 'expired', rowVersion: { increment: 1 } } });
        if (count === 1) await this.record(tx, memo, 'discount_memo.expired', {}, systemActor('discount_memos.expire'));
      });
    }
    return due.length;
  }

  async record(tx: Tx, memo: DiscountMemo, type: string, data: Record<string, unknown>, actor: Actor) {
    const event = await this.events.record(
      tx,
      { type, aggregateType: 'discount_memo', aggregateId: memo.publicId, payload: { memoId: memo.publicId, ...data } },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'discount_memo',
      aggregatePublicId: memo.publicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal'],
      domainEventId: event.id,
      actor,
    });
  }
}
