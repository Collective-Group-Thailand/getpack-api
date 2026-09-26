import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { RfqsService } from './rfqs.service';

@Injectable()
export class RfqJobs {
  constructor(private readonly rfqs: RfqsService) {}

  /** Sent quotations past their validity expire (D-051); overdue factory consultations close. */
  @ScheduledJob({ name: 'rfq.expire', every: 5 * 60_000 })
  expire(): Promise<number> {
    return this.rfqs.expireDue();
  }
}
