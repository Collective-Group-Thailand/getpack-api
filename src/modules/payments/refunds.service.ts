import { TWOC2P_GATEWAY, type TwoC2PGateway } from '@collective/integrations/payments/gateways';
import { type Actor, systemActor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal } from '@common/money/money';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma, type Refund, type RefundChannel } from '@generated/prisma/client';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { ApprovalsService } from '@platform/approvals/approvals.service';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

const D = (v: string | Prisma.Decimal | number) => new MoneyDecimal(v.toString());
const POLICY = 'refund';
const OPEN_REFUNDS = ['requested', 'pending_approval', 'approved', 'processing'] as const;

export const REFUND_INCLUDE = {
  payment: { include: { orderGroup: true } },
  order: true,
  cancelReason: true,
  approvalRequest: true,
} as const satisfies Prisma.RefundInclude;
export type RefundRow = Prisma.RefundGetPayload<{ include: typeof REFUND_INCLUDE }>;

export interface RefundInput {
  amount: string;
  reasonNote: string;
  channel?: RefundChannel;
  cancelReasonCode?: string;
  orderId?: string;
}

/**
 * Refunds (B3.2, accounting-design §8 maker-checker, D-169): requested by CS / Finance, approved by the
 * Finance Manager through the approvals engine (the requester never approves), then executed — through
 * the original gateway where it offers a refund API (2C2P), otherwise by a bank transfer Finance records
 * (SCB QR, slips). Only money the schedule no longer needs is refundable: a closed group, an unidentified
 * receipt or a payment's unallocated cash. Events `refund.*` feed the ledger (P22) and notifications.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
    @Inject(TWOC2P_GATEWAY) private readonly twoc2p: TwoC2PGateway,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
  ) {}

  async refund(publicId: string, db: Tx = this.prisma): Promise<RefundRow> {
    const row = await db.refund.findUnique({ where: { publicId }, include: REFUND_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    return row;
  }

  async list(where: Prisma.RefundWhereInput, page: number, perPage: number) {
    const [rows, total] = await Promise.all([
      this.prisma.refund.findMany({
        where,
        include: REFUND_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.refund.count({ where }),
    ]);
    return { rows, total };
  }

  /** Requests a refund and routes it to the Finance Manager (`refund` approval policy). */
  async request(actor: UserActor, paymentPublicId: string, input: RefundInput): Promise<RefundRow> {
    return this.prisma.withTx((tx) => this.requestIn(tx, actor, paymentPublicId, input));
  }

  /** `request` inside the caller's transaction (claim resolutions, B4.5). */
  async requestIn(tx: Tx, actor: UserActor, paymentPublicId: string, input: RefundInput): Promise<RefundRow> {
    const payment = await tx.payment.findUnique({
      where: { publicId: paymentPublicId },
      include: { orderGroup: true, allocations: true, refunds: true },
    });
    if (!payment) throw new DomainException('http.not_found');
    if (!['succeeded', 'partially_refunded'].includes(payment.status))
      throw new DomainException('refunds.not_refundable', {
        params: { reason: `payment is ${payment.status}` },
      });
    const amount = D(input.amount);
    const pending = payment.refunds
      .filter((r) => (OPEN_REFUNDS as readonly string[]).includes(r.status))
      .reduce((a, r) => a.add(r.amount.toString()), new MoneyDecimal(0));
    const allocated = payment.allocations.reduce(
      (a, x) => a.add(x.cashAmount.toString()),
      new MoneyDecimal(0),
    );
    const closed = !payment.orderGroup || ['cancelled', 'completed'].includes(payment.orderGroup.status);
    const refundable = (closed ? D(payment.cashAmount) : D(payment.cashAmount).sub(allocated))
      .sub(payment.refundedAmount.toString())
      .sub(pending);
    if (amount.lte(0) || amount.gt(refundable))
      throw new DomainException('refunds.not_refundable', {
        params: { reason: `at most ${formatMoney(MoneyDecimal.max(refundable, 0))} can be refunded` },
      });
    const channel: RefundChannel =
      input.channel ?? (payment.provider === 'twoc2p' ? 'original_gateway' : 'bank_transfer');
    if (channel === 'store_credit' || (channel === 'original_gateway' && payment.provider !== 'twoc2p'))
      throw new DomainException('refunds.channel_unavailable', { params: { channel } });
    const reason = input.cancelReasonCode
      ? await tx.orderCancelReason.findUnique({ where: { code: input.cancelReasonCode } })
      : null;
    if (input.cancelReasonCode && !reason)
      throw new DomainException('validation.failed', {
        errors: [{ path: 'cancelReasonCode', code: 'exists', message: 'unknown cancel reason' }],
      });
    const order = input.orderId
      ? await tx.order.findFirst({
          where: { publicId: input.orderId, orderGroupId: payment.orderGroupId ?? -1n },
        })
      : null;
    if (input.orderId && !order) throw new DomainException('http.not_found');
    const refund = await tx.refund.create({
      data: {
        entityId: payment.entityId,
        paymentId: payment.id,
        orderId: order?.id ?? null,
        amount: formatMoney(amount),
        cancelReasonId: reason?.id ?? null,
        reasonNote: input.reasonNote,
        channel,
        status: 'pending_approval',
        requestedById: actor.userId,
      },
    });
    const request = await this.approvals.create(tx, {
      policyKey: POLICY,
      subject: { type: 'refund', id: refund.id, publicId: refund.publicId },
      requester: actor,
      amount: formatMoney(amount),
      entityId: payment.entityId,
      payload: {
        paymentId: payment.publicId,
        reference: payment.referenceCode,
        amount: formatMoney(amount),
        channel,
        reason: input.reasonNote,
      },
    });
    await tx.refund.update({ where: { id: refund.id }, data: { approvalRequestId: request.id } });
    await this.record(tx, refund, 'refund.requested', { amount: formatMoney(amount), channel }, actor);
    return this.refund(refund.publicId, tx);
  }

  @OnDomainEvent(['approval.approved', 'approval.rejected', 'approval.withdrawn', 'approval.expired'], {
    consumer: 'payments.refunds',
  })
  async onApprovalOutcome(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['policyKey'] !== POLICY) return;
    const request = await tx.approvalRequest.findUnique({ where: { publicId: event.aggregateId } });
    if (!request) return;
    const refund = await tx.refund.findFirst({
      where: { approvalRequestId: request.id, status: 'pending_approval' },
    });
    if (!refund) return;
    const approved = event.type === 'approval.approved';
    const updated = await tx.refund.update({
      where: { id: refund.id },
      data: {
        status: approved ? 'approved' : 'rejected',
        decidedAt: new Date(),
        rowVersion: { increment: 1 },
      },
    });
    await this.record(
      tx,
      updated,
      approved ? 'refund.approved' : 'refund.rejected',
      {},
      systemActor('payments.refunds'),
    );
  }

  /** Scheduled: approved gateway refunds are sent to the provider (outside any transaction). */
  async executeApproved(limit = 50): Promise<number> {
    const due = await this.prisma.refund.findMany({
      where: { status: 'approved', channel: 'original_gateway' },
      include: { payment: true },
      take: limit,
    });
    for (const refund of due) {
      const { count } = await this.prisma.refund.updateMany({
        where: { id: refund.id, status: 'approved' },
        data: { status: 'processing', rowVersion: { increment: 1 } },
      });
      if (count === 0) continue;
      try {
        const result = await this.twoc2p.refund({
          reference: refund.payment.referenceCode,
          amount: refund.amount.toFixed(2),
          idempotencyId: refund.publicId,
        });
        if (result.status === 'succeeded')
          await this.complete(refund.id, result.providerRef, null, systemActor('refunds.execute'));
        else if (result.status === 'failed') await this.fail(refund.id, result.message);
        else
          await this.prisma.refund.update({
            where: { id: refund.id },
            data: { providerRef: result.providerRef, rowVersion: { increment: 1 } },
          });
      } catch (error) {
        this.logger.warn(`refund ${refund.publicId} not sent: ${(error as Error).message}`);
        await this.prisma.refund.update({
          where: { id: refund.id },
          data: { status: 'approved', rowVersion: { increment: 1 } },
        });
      }
    }
    return due.length;
  }

  /** Finance records a bank-transfer refund (or confirms a pending gateway one) once the money left. */
  async markCompleted(actor: UserActor, publicId: string, providerRef: string): Promise<RefundRow> {
    const refund = await this.refund(publicId);
    if (!['approved', 'processing'].includes(refund.status))
      throw new DomainException('refunds.not_approved', { params: { status: refund.status } });
    if (refund.requestedById === actor.userId)
      throw new DomainException('iam.sod_conflict', { params: { rule: 'refund requester ≠ executor' } });
    await this.complete(refund.id, providerRef, actor.userId, actor);
    return this.refund(publicId);
  }

  private async complete(
    refundId: bigint,
    providerRef: string | null,
    completedById: bigint | null,
    actor: Actor,
  ) {
    await this.prisma.withTx(async (tx) => {
      const refund = await tx.refund.update({
        where: { id: refundId },
        data: {
          status: 'succeeded',
          providerRef,
          completedAt: new Date(),
          completedById,
          rowVersion: { increment: 1 },
        },
        include: { payment: { include: { allocations: true } } },
      });
      const refunded = D(refund.payment.refundedAmount).add(refund.amount.toString());
      const full = refunded.gte(refund.payment.cashAmount.toString());
      await tx.payment.update({
        where: { id: refund.paymentId },
        data: {
          refundedAmount: formatMoney(refunded),
          status: full ? 'refunded' : 'partially_refunded',
          rowVersion: { increment: 1 },
        },
      });
      if (full) {
        await tx.instalment.updateMany({
          where: { id: { in: refund.payment.allocations.map((a) => a.instalmentId) }, status: 'paid' },
          data: { status: 'refunded', rowVersion: { increment: 1 } },
        });
      }
      await this.record(
        tx,
        refund,
        'refund.succeeded',
        { amount: refund.amount.toFixed(2), channel: refund.channel },
        actor,
      );
    });
  }

  private async fail(refundId: bigint, message: string) {
    await this.prisma.withTx(async (tx) => {
      const refund = await tx.refund.update({
        where: { id: refundId },
        data: { status: 'failed', failureReason: message.slice(0, 500), rowVersion: { increment: 1 } },
      });
      await this.record(tx, refund, 'refund.failed', { message }, systemActor('refunds.execute'));
    });
  }

  private async record(tx: Tx, refund: Refund, type: string, data: Record<string, unknown>, actor: Actor) {
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: refund.paymentId },
      include: { orderGroup: true },
    });
    const event = await this.events.record(
      tx,
      {
        type,
        aggregateType: 'refund',
        aggregateId: refund.publicId,
        entityId: refund.entityId,
        payload: {
          refundId: refund.publicId,
          paymentId: payment.publicId,
          groupId: payment.orderGroup?.publicId ?? null,
          ...data,
        },
      },
      actor,
    );
    await this.activity.record(tx, {
      aggregateType: payment.orderGroup ? 'order_group' : 'payment',
      aggregatePublicId: payment.orderGroup?.publicId ?? payment.publicId,
      action: type,
      messageKey: `activity.${type}`,
      messageParams: data,
      visibility: ['internal', 'customer'],
      domainEventId: event.id,
      actor,
    });
  }
}
