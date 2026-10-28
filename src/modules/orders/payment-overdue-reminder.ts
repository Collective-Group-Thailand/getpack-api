import { systemActor } from '@common/context/actor';
import { PrismaService } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';
import { FeatureFlagsService } from '@platform/feature-flags/feature-flags.service';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { OrdersService } from './orders.service';

/** D-453 (owner's C6 item): the feature flag of the one-time overdue-payment reminder; seeded off. */
export const PAYMENT_OVERDUE_REMINDER_FLAG = 'orders.payment_overdue_reminder';
export const PAYMENT_OVERDUE_EVENT = 'order_group.payment_overdue';
/** Groups handled per run; the rest wait for the next run. */
const BATCH = 200;

/**
 * D-453 (closes the A2 open question "no overdue notification", D-436): once an unpaid group passes its payment
 * deadline, ONE `order_group.payment_overdue` event is recorded for that deadline (event + customer-visible activity in
 * one transaction). The customer's e-mail / LINE message is the notification router's subscriber to that event, with
 * the "ตรวจราคาใหม่และชำระ" link to the order (never a cancellation — D-436). A re-quote sets a new deadline; if that one
 * passes too, the group gets one reminder for it. Behind the flag `orders.payment_overdue_reminder` (off by default).
 */
@Injectable()
export class PaymentOverdueReminder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @ScheduledJob({ name: 'orders.payment_overdue_reminder', every: 15 * 60_000 })
  async run(now: Date = new Date()): Promise<number> {
    if (!(await this.flags.isEnabled(PAYMENT_OVERDUE_REMINDER_FLAG))) return 0;
    const due = await this.prisma.$queryRaw<{ id: bigint }[]>`
      SELECT g.id FROM order_groups g
       WHERE g.status = 'waiting_payment' AND g.cancelled_at IS NULL
         AND g.expires_at IS NOT NULL AND g.expires_at < ${now}
         AND NOT EXISTS (
           SELECT 1 FROM domain_events e
            WHERE e.type = ${PAYMENT_OVERDUE_EVENT} AND e.aggregate_id = g.public_id
              AND e.payload->>'dueAt' = to_char(g.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
       ORDER BY g.expires_at ASC
       LIMIT ${BATCH}`;
    const actor = systemActor('orders.payment_overdue_reminder');
    let sent = 0;
    for (const { id } of due) {
      const recorded = await this.prisma.withTx(async (tx) => {
        await tx.$queryRaw`SELECT id FROM order_groups WHERE id = ${id} FOR UPDATE`;
        const group = await tx.orderGroup.findUniqueOrThrow({
          where: { id },
          select: {
            publicId: true,
            groupCode: true,
            status: true,
            expiresAt: true,
            grossAmount: true,
            cashAmount: true,
            orders: {
              where: { cancelledAt: null },
              orderBy: { id: 'asc' },
              select: { publicId: true, orderCode: true },
            },
          },
        });
        // Re-checked under the lock: paid, re-quoted or cancelled meanwhile → nothing to say.
        if (group.status !== 'waiting_payment' || !group.expiresAt || group.expiresAt >= now) return false;
        const first = group.orders[0];
        if (!first) return false;
        await this.orders.record(
          tx,
          'order_group',
          group.publicId,
          PAYMENT_OVERDUE_EVENT,
          {
            groupCode: group.groupCode,
            dueAt: group.expiresAt.toISOString(),
            grossAmount: group.grossAmount.toFixed(2),
            cashAmount: group.cashAmount.toFixed(2),
            orderCount: group.orders.length,
            // The order page holds the "ตรวจราคาใหม่และชำระ" action for the whole group (D-436).
            orderId: first.publicId,
            orderCode: first.orderCode,
          },
          actor,
        );
        return true;
      });
      if (recorded) sent += 1;
    }
    return sent;
  }
}
