import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal } from '@common/money/money';
import { PrismaService } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

/** Technical anti-spam bound: one manual reminder per order group per hour. */
const REMINDER_GAP_MS = 60 * 60_000;
const OPEN = ['due', 'overdue', 'partially_paid'] as const;

/**
 * CS sends the customer a reminder of the instalment due on an order's group (U-B0.2, D-143): an
 * `instalment.reminder` event — the notification matrix delivers it (e-mail, LINE). Nothing due answers
 * `payments.nothing_due`; a second reminder within the hour `payments.reminder_recent`.
 */
@Injectable()
export class PaymentRemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
  ) {}

  async remind(actor: UserActor, orderPublicId: string): Promise<void> {
    await this.prisma.withTx(async (tx) => {
      const order = await tx.order.findUnique({
        where: { publicId: orderPublicId },
        include: {
          orderGroup: {
            include: {
              paymentSchedule: { include: { instalments: { orderBy: { seq: 'asc' } } } },
            },
          },
        },
      });
      if (!order) throw new DomainException('http.not_found');
      const group = order.orderGroup;
      await tx.$queryRaw`SELECT id FROM order_groups WHERE id = ${group.id} FOR UPDATE`;
      const due = group.paymentSchedule?.instalments.find((i) =>
        (OPEN as readonly string[]).includes(i.status),
      );
      if (!due || group.status === 'cancelled') throw new DomainException('payments.nothing_due');
      const recent = await tx.domainEvent.count({
        where: {
          type: 'instalment.reminder',
          aggregateId: group.publicId,
          occurredAt: { gt: new Date(Date.now() - REMINDER_GAP_MS) },
        },
      });
      if (recent > 0) throw new DomainException('payments.reminder_recent');
      const data = {
        seq: due.seq,
        cashAmount: formatMoney(new MoneyDecimal(due.cashAmount.toString()).sub(due.paidAmount.toString())),
        dueAt: due.dueAt?.toISOString() ?? null,
        groupCode: group.groupCode,
        orderId: order.publicId,
      };
      const event = await this.events.record(
        tx,
        {
          type: 'instalment.reminder',
          aggregateType: 'order_group',
          aggregateId: group.publicId,
          payload: { groupId: group.publicId, ...data },
        },
        actor,
      );
      await this.activity.record(tx, {
        aggregateType: 'order_group',
        aggregatePublicId: group.publicId,
        action: 'instalment.reminder',
        messageKey: 'activity.instalment.reminder',
        messageParams: data,
        visibility: ['internal', 'customer'],
        domainEventId: event.id,
        actor,
      });
    });
  }

  /** The same for several orders; each is its own transaction, refusals are reported. */
  async remindMany(actor: UserActor, orderPublicIds: string[]) {
    const skipped: { orderId: string; reason: string }[] = [];
    let sent = 0;
    for (const id of [...new Set(orderPublicIds)]) {
      try {
        await this.remind(actor, id);
        sent += 1;
      } catch (error) {
        if (!(error instanceof DomainException)) throw error;
        skipped.push({ orderId: id, reason: error.code });
      }
    }
    return { sent, skipped };
  }
}
