import { Global, Module } from '@nestjs/common';

import { AdminOrdersService } from './admin-orders.service';
import { OrderOperationsService } from './order-operations.service';
import { OrdersJobs } from './orders.jobs';
import { OrderLifecycleHooks, OrdersService } from './orders.service';

/** Orders and order groups (B3.1): reads, fact-driven status, cancellation, unpaid expiry (D-060). */
@Global()
@Module({
  providers: [OrdersService, OrderLifecycleHooks, OrdersJobs, OrderOperationsService, AdminOrdersService],
  exports: [OrdersService, OrderLifecycleHooks, OrderOperationsService, AdminOrdersService],
})
export class OrdersModule {}
