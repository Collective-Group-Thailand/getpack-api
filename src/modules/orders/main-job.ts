import { type JobKind, type OrderKind } from '@generated/prisma/client';

/**
 * D-253: the job that makes an order — a standalone sample order (kind `sample`) is made by a `mockup` job on the
 * mockup route, every other order by its `production` job. Delivery, claims, the ship plan and the timeline follow it.
 */
export function mainJobKind(kind: OrderKind): JobKind {
  return kind === 'sample' ? 'mockup' : 'production';
}
