import { type Prisma } from '@generated/prisma/client';

/** `admin.payments.slipQueue`: slips that failed automatic verification (D-061), shared with the dashboard card. */
export const SLIP_QUEUE_WHERE: Prisma.SlipWhereInput = { verificationStatus: 'manual_review' };

/** The `admin.refunds.list` filter, shared with the dashboard's refunds-to-pay card (`status=approved`). */
export function refundListWhere(q: { status?: Prisma.RefundWhereInput['status'] }): Prisma.RefundWhereInput {
  return q.status ? { status: q.status } : {};
}
