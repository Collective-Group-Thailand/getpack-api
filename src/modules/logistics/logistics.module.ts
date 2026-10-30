import { Global, Module } from '@nestjs/common';

import { LogisticsSubscribers } from './carrier-events.subscriber';
import { DeliveryService } from './delivery.service';
import { ShipmentHandoverService } from './handover.service';
import { ShipmentsService } from './shipments.service';
import { ShipmentsQueryService } from './shipments-query.service';

const SERVICES = [
  ShipmentsService,
  ShipmentsQueryService,
  DeliveryService,
  ShipmentHandoverService,
  LogisticsSubscribers,
];

/** Shipments, proofs of delivery, tolerance reconciliation and order completion (D-013, D-021, D-080, D-081, B4.3). */
@Global()
@Module({ providers: SERVICES, exports: SERVICES })
export class LogisticsModule {}
