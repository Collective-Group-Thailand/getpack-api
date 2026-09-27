import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { OrdersService } from './orders.service';

/** Order housekeeping in the worker. */
@Injectable()
export class OrdersJobs {
  constructor(private readonly orders: OrdersService) {}

  /** Unpaid order groups past `expires_at` are cancelled every minute (D-060, legacy `orders:cancel-expired`). */
  @ScheduledJob({ name: 'orders.expire_unpaid', every: 60_000 })
  expireUnpaid(): Promise<number> {
    return this.orders.expireUnpaid();
  }
}
