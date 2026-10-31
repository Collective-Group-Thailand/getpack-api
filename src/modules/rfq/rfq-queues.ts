import { type Prisma } from '@generated/prisma/client';

/** Staff work queues of RFQs, shared by `admin.rfqs.list?queue=` and the admin dashboard counts (U-B0.3). */
export const RFQ_QUEUES = ['awaiting_first_response'] as const;
export type RfqQueue = (typeof RFQ_QUEUES)[number];

export const RFQ_QUEUE_WHERE: Record<RfqQueue, Prisma.RfqWhereInput> = {
  // D-175: open requests nobody has answered yet (the first-response SLA runs on `slaDueAt`).
  awaiting_first_response: { status: { in: ['submitted', 'in_review', 'need_info'] }, firstResponseAt: null },
};
