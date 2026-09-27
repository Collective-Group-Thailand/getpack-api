import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { PaymentSchedulesService } from './payment-schedules.service';

/** Instalment housekeeping in the worker. */
@Injectable()
export class PaymentSchedulesJobs {
  constructor(private readonly schedules: PaymentSchedulesService) {}

  /** Instalments reaching their due date become due; delivery-based ones past it overdue (D-143 notices). */
  @ScheduledJob({ name: 'instalments.refresh', every: 5 * 60_000 })
  refresh(): Promise<number> {
    return this.schedules.refreshStatuses();
  }
}
