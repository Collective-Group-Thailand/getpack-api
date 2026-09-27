import { type Actor, systemActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { formatMoney, MoneyDecimal } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Order, type Prisma } from '@generated/prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { applyFact, groupStatusOf, type OrderFact, type OrderFacts } from './order-state';
import { GROUP_INCLUDE, ORDER_INCLUDE, type OrderGroupRow, type OrderRow } from './order-views';

export const groupEtag = (g: { publicId: string; rowVersion: number }) => etagOf(g.publicId, g.rowVersion);

/**
 * A module that must keep an unpaid group alive past its expiry (a slip waiting for verification, B3.2)
 * or that needs to know about a cancellation before it happens registers here.
 */
export interface OrderLifecycleHook {
  readonly key: string;
  /** True when the unpaid group must not be cancelled now (D-060). */
  blocksExpiry?(tx: Tx, groupId: bigint): Promise<boolean>;
  /** Amount already paid on the group (refund needed on cancel, B3.2); THB decimal string. */
  paidAmount?(tx: Tx, groupId: bigint): Promise<string>;
}

@Injectable()
export class OrderLifecycleHooks {
  private readonly hooks = new Map<string, OrderLifecycleHook>();
  register(hook: OrderLifecycleHook): void {
    this.hooks.set(hook.key, hook);
  }
  list(): OrderLifecycleHook[] {
    return [...this.hooks.values()];
  }
}

const FACTS_OF = (o: Order): OrderFacts => ({
  paidForProductionAt: o.paidForProductionAt,
  artworkApprovedAt: o.artworkApprovedAt,
  productionStartedAt: o.productionStartedAt,
  shippedAt: o.shippedAt,
  deliveredAt: o.deliveredAt,
  completedAt: o.completedAt,
  cancelledAt: o.cancelledAt,
});

export interface CancelInput {
  reasonCode: string;
  note?: string | null;
}

/**
 * Orders and order groups (B3.1): reads for the store and the admin zone, the fact-driven status
 * machine (`OrderFactsService` role: B3.2 payments, B4 artwork / production / shipping call `applyFact`
 * inside their own transaction), cancellation with a reason (credit notes are B5) and the per-minute
 * unpaid expiry (D-060). Every change: one transaction, activity rows and domain events.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hooks: OrderLifecycleHooks,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
  ) {}

  // --- reads ----------------------------------------------------------------------------------------

  async group(publicId: string, customerUserId?: bigint, db: Tx = this.prisma): Promise<OrderGroupRow> {
    const row = await db.orderGroup.findUnique({ where: { publicId }, include: GROUP_INCLUDE });
    if (!row || (customerUserId !== undefined && row.customerUserId !== customerUserId))
      throw new DomainException('http.not_found');
    return row;
  }

  async order(where: Prisma.OrderWhereUniqueInput, customerUserId?: bigint, db: Tx = this.prisma): Promise<OrderRow> {
    const row = await db.order.findUnique({ where, include: ORDER_INCLUDE });
    if (!row || (customerUserId !== undefined && row.customerUserId !== customerUserId))
      throw new DomainException('http.not_found');
    return row;
  }

  async groups(where: Prisma.OrderGroupWhereInput, page: number, perPage: number) {
    const [rows, total] = await Promise.all([
      this.prisma.orderGroup.findMany({
        where,
        include: GROUP_INCLUDE,
        orderBy: { placedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.orderGroup.count({ where }),
    ]);
    return { rows, total };
  }

  // --- facts ----------------------------------------------------------------------------------------

  /**
   * Records a fact on an order in the caller's transaction and moves its status and its group's status.
   * Returns false when the fact was already recorded. Invalid facts → `409 order.invalid_transition`.
   */
  async applyFact(tx: Tx, orderId: bigint, fact: OrderFact, actor: Actor, at = new Date()): Promise<boolean> {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const result = applyFact(FACTS_OF(order), fact, at);
    if (!result.ok) {
      throw new DomainException('order.invalid_transition', {
        params: { from: order.status, fact: fact.kind, reason: result.reason },
      });
    }
    if (!result.changed) return false;
    const f = result.facts;
    await tx.order.update({
      where: { id: order.id },
      data: {
        paidForProductionAt: f.paidForProductionAt,
        artworkApprovedAt: f.artworkApprovedAt,
        productionStartedAt: f.productionStartedAt,
        shippedAt: f.shippedAt,
        deliveredAt: f.deliveredAt,
        completedAt: f.completedAt,
        cancelledAt: f.cancelledAt,
        ...(fact.kind === 'production_started' && { startMode: fact.mode }),
        ...(fact.kind === 'completed' && { completionMode: fact.mode }),
        ...(fact.kind === 'artwork_approved' && { artworkStatus: 'approved' }),
        ...(result.status !== order.status && { status: result.status, statusChangedAt: at }),
        updatedById: actor.type === 'user' ? actor.userId : null,
        rowVersion: { increment: 1 },
      },
    });
    if (result.status !== order.status) {
      await this.record(tx, 'order', order.publicId, 'order.status_changed', {
        from: order.status,
        to: result.status,
        fact: fact.kind,
      }, actor);
    }
    await this.refreshGroup(tx, order.orderGroupId, actor, at);
    return true;
  }

  // --- cancel ---------------------------------------------------------------------------------------

  /** Cancels every order of a group that has not started production (customer: unpaid groups only). */
  async cancelGroup(
    actor: Actor,
    publicId: string,
    input: CancelInput,
    opts: { customerUserId?: bigint; ifMatch?: string } = {},
  ): Promise<OrderGroupRow> {
    return this.prisma.withTx(async (tx) => {
      const group = await this.group(publicId, opts.customerUserId, tx);
      assertIfMatch(opts.ifMatch, groupEtag(group), { required: false });
      if (group.status === 'cancelled' || group.status === 'completed')
        throw new DomainException('order.invalid_transition', {
          params: { from: group.status, fact: 'cancelled', reason: `the group is ${group.status}` },
        });
      const reason = await this.reason(tx, input.reasonCode, opts.customerUserId !== undefined);
      const paid = await this.paidAmount(tx, group.id);
      if (opts.customerUserId !== undefined && (group.status !== 'waiting_payment' || paid !== '0.00'))
        throw new DomainException('order.cancel_not_allowed');
      const at = new Date();
      for (const order of group.orders.filter((o) => o.status !== 'cancelled')) {
        await this.cancelOne(tx, order, reason.id, input.note ?? null, actor, at);
      }
      await this.record(tx, 'order_group', group.publicId, 'order_group.cancelled', {
        reasonCode: reason.code,
        paidAmount: paid,
        refundRequired: paid !== '0.00',
      }, actor);
      return this.group(publicId, undefined, tx);
    });
  }

  /** Cancels one order of a group before production (staff); the group follows its orders. */
  async cancelOrder(actor: Actor, publicId: string, input: CancelInput): Promise<OrderRow> {
    return this.prisma.withTx(async (tx) => {
      const order = await this.order({ publicId }, undefined, tx);
      const reason = await this.reason(tx, input.reasonCode, false);
      await this.cancelOne(tx, order, reason.id, input.note ?? null, actor, new Date());
      return this.order({ publicId }, undefined, tx);
    });
  }

  private async cancelOne(tx: Tx, order: Order, reasonId: bigint, note: string | null, actor: Actor, at: Date) {
    const result = applyFact(FACTS_OF(order), { kind: 'cancelled' }, at);
    if (!result.ok)
      throw new DomainException('order.invalid_transition', {
        params: { from: order.status, fact: 'cancelled', reason: result.reason },
      });
    if (!result.changed) return;
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: 'cancelled',
        statusChangedAt: at,
        cancelledAt: at,
        cancelReasonId: reasonId,
        cancelNote: note,
        updatedById: actor.type === 'user' ? actor.userId : null,
        rowVersion: { increment: 1 },
      },
    });
    const reason = await tx.orderCancelReason.findUniqueOrThrow({ where: { id: reasonId } });
    await this.record(tx, 'order', order.publicId, 'order.cancelled', {
      from: order.status,
      reasonCode: reason.code,
      requiresCreditNote: reason.requiresCreditNote,
      grossAmount: order.grossAmount.toFixed(2),
    }, actor);
    await this.refreshGroup(tx, order.orderGroupId, actor, at, reasonId, note);
  }

  // --- unpaid expiry (D-060) --------------------------------------------------------------------------

  /** Scheduled every minute: unpaid groups past `expires_at` are cancelled (`payment_expired`). */
  async expireUnpaid(now = new Date(), limit = 200): Promise<number> {
    const due = await this.prisma.orderGroup.findMany({
      where: { status: 'waiting_payment', expiresAt: { lte: now } },
      select: { id: true, publicId: true },
      orderBy: { expiresAt: 'asc' },
      take: limit,
    });
    let cancelled = 0;
    const actor = systemActor('orders.expire_unpaid');
    for (const { id, publicId } of due) {
      try {
        await this.prisma.withTx(async (tx) => {
          const group = await tx.orderGroup.findUniqueOrThrow({ where: { id }, include: { orders: true } });
          if (group.status !== 'waiting_payment' || !group.expiresAt || group.expiresAt > now) return;
          for (const hook of this.hooks.list()) {
            if (hook.blocksExpiry && (await hook.blocksExpiry(tx, id))) return;
          }
          const reason = await tx.orderCancelReason.findUniqueOrThrow({ where: { code: 'payment_expired' } });
          for (const order of group.orders.filter((o) => o.status !== 'cancelled')) {
            await this.cancelOne(tx, order, reason.id, null, actor, now);
          }
          await this.record(tx, 'order_group', publicId, 'order_group.expired', {
            expiresAt: group.expiresAt.toISOString(),
          }, actor);
          cancelled += 1;
        });
      } catch (error) {
        this.logger.error(`unpaid expiry failed for group ${publicId}: ${(error as Error).message}`);
      }
    }
    return cancelled;
  }

  // --- helpers --------------------------------------------------------------------------------------

  /** The group follows its orders; leaving `waiting_payment` clears the unpaid expiry. */
  private async refreshGroup(
    tx: Tx,
    groupId: bigint,
    actor: Actor,
    at: Date,
    cancelReasonId: bigint | null = null,
    cancelNote: string | null = null,
  ) {
    const group = await tx.orderGroup.findUniqueOrThrow({ where: { id: groupId }, include: { orders: true } });
    const status = groupStatusOf(group.status, group.orders.map((o) => o.status));
    if (status === group.status) return;
    await tx.orderGroup.update({
      where: { id: group.id },
      data: {
        status,
        ...(status !== 'waiting_payment' && { expiresAt: null }),
        ...(status === 'cancelled' && {
          cancelledAt: at,
          cancelReasonId: cancelReasonId ?? group.orders.find((o) => o.cancelReasonId)?.cancelReasonId ?? null,
          cancelNote,
        }),
        rowVersion: { increment: 1 },
      },
    });
    await this.record(tx, 'order_group', group.publicId, 'order_group.status_changed', {
      from: group.status,
      to: status,
    }, actor);
  }

  private async reason(tx: Tx, code: string, customer: boolean) {
    const reason = await tx.orderCancelReason.findUnique({ where: { code } });
    if (!reason || !reason.active || reason.appliesTo === 'system' || (customer && reason.appliesTo !== 'customer')) {
      throw new DomainException('validation.failed', {
        errors: [{ path: 'reasonCode', code: 'invalid', message: 'not a cancel reason you may use' }],
      });
    }
    return reason;
  }

  private async paidAmount(tx: Tx, groupId: bigint): Promise<string> {
    let paid = new MoneyDecimal(0);
    for (const hook of this.hooks.list()) {
      if (hook.paidAmount) paid = paid.add(await hook.paidAmount(tx, groupId));
    }
    return formatMoney(paid);
  }

  async record(
    tx: Tx,
    aggregateType: 'order' | 'order_group',
    publicId: string,
    type: string,
    data: Record<string, unknown>,
    actor: Actor,
  ): Promise<void> {
    const key = aggregateType === 'order' ? 'orderId' : 'groupId';
    const event = await this.events.record(
      tx,
      { type, aggregateType, aggregateId: publicId, payload: { [key]: publicId, ...data } },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType,
      aggregatePublicId: publicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal', 'customer'],
      domainEventId: event.id,
      actor,
    });
  }
}

