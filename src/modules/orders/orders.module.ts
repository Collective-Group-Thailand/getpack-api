import { Global, Module } from '@nestjs/common';

import { AdminOrdersService } from './admin-orders.service';
import { OrderOperationsService } from './order-operations.service';
import { OrderRequoteService } from './order-requote.service';
import { OrderLifecycleHooks, OrdersService } from './orders.service';
import { SpecSheetService } from './spec-sheet.service';

/**
 * Orders and order groups (B3.1): reads, fact-driven status, cancellation; past the payment deadline a group is
 * re-quoted by the customer, never cancelled (D-060, D-436).
 */
@Global()
@Module({
  providers: [
    OrdersService,
    OrderLifecycleHooks,
    OrderOperationsService,
    OrderRequoteService,
    AdminOrdersService,
    SpecSheetService,
  ],
  exports: [
    OrdersService,
    OrderLifecycleHooks,
    OrderOperationsService,
    OrderRequoteService,
    AdminOrdersService,
    SpecSheetService,
  ],
})
export class OrdersModule {}
