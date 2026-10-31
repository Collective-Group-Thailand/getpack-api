import { type Prisma } from '@generated/prisma/client';

/** Staff work queues of claims (D-082), shared by `admin.claims.list?queue=` and the admin dashboard (U-B0.3). */
export const CLAIM_QUEUES = ['open'] as const;
export type ClaimQueue = (typeof CLAIM_QUEUES)[number];

export const CLAIM_QUEUE_WHERE: Record<ClaimQueue, Prisma.ClaimWhereInput> = {
  // Claims someone at getpack still has to work: submitted, under review, waiting for information or the factory.
  open: { status: { in: ['submitted', 'under_review', 'need_info', 'factory_review'] } },
};
