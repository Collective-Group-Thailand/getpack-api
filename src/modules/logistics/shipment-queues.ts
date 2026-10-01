import { type Prisma } from '@generated/prisma/client';

import { type SHIPMENT_QUEUES } from './logistics.dto';

/** Staff work queues of shipments (D-229, D-230); shared with the admin dashboard counts (U-B0.3). */
export const SHIPMENT_QUEUE_WHERE: Record<(typeof SHIPMENT_QUEUES)[number], Prisma.ShipmentWhereInput> = {
  awaiting_pickup: { status: 'ready' },
  in_transit: { status: { in: ['picked_up', 'in_transit', 'out_for_delivery'] } },
  exceptions: { OR: [{ status: 'failed' }, { status: 'returned', exceptionResolvedAt: null }] },
  pod_review: { status: 'delivered', proofOfDelivery: { reviews: { none: {} } } },
};
