import { Global, Module } from '@nestjs/common';

import { OrdersJobs } from './orders.jobs';
import { OrderLifecycleHooks, OrdersService } from './orders.service';

/** Orders and order groups (B3.1): reads, fact-driven status, cancellation, unpaid expiry (D-060). */
@Global()
@Module({
  providers: [OrdersService, OrderLifecycleHooks, OrdersJobs],
  exports: [OrdersService, OrderLifecycleHooks],
})
export class OrdersModule {}
