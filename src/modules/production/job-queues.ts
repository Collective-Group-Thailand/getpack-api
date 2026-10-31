import { type Prisma } from '@generated/prisma/client';

/**
 * Staff work queues of production jobs (D-074, D-012, D-075), shared by `admin.production.list?queue=`, the
 * production board's `awaiting_acceptance` column and the admin dashboard counts (U-B0.3).
 */
export const JOB_QUEUES = ['escalated', 'at_risk', 'awaiting_acceptance'] as const;
export type JobQueue = (typeof JOB_QUEUES)[number];

export const JOB_QUEUE_WHERE: Record<JobQueue, Prisma.ProductionJobWhereInput> = {
  // Released to the factory, not accepted yet ("รอโรงงานรับงาน").
  awaiting_acceptance: { status: 'released' },
  escalated: { escalatedAt: { not: null }, status: { in: ['released', 'rejected'] } },
  at_risk: { atRiskSince: { not: null }, status: { in: ['accepted', 'in_progress', 'on_hold'] } },
};
