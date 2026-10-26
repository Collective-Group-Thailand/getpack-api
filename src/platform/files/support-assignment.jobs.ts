import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { CustomerFileAccessService } from './customer-file-access.service';

/** B-API-7 (D-446): explicit order support assignments end with the order's claim window. */
@Injectable()
export class SupportAssignmentJobs {
  constructor(private readonly access: CustomerFileAccessService) {}

  /** Same cadence as `orders.auto_complete`: the window ends on a date, a quarter-hour delay is immaterial. */
  @ScheduledJob({ name: 'orders.support_assignment_end', every: 15 * 60_000 })
  endAfterClaimWindow(): Promise<number> {
    return this.access.endAfterClaimWindow();
  }
}
