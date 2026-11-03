import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { SalesInboundService } from './sales-inbound.service';

/** The company sales desk's housekeeping in the worker (D-469, D-470). */
@Injectable()
export class SalesDeskJobs {
  constructor(private readonly inbound: SalesInboundService) {}

  /** D-469 item 4: an unanswered enquiry past its first-response time is flagged once and the managers alerted. */
  @ScheduledJob({ name: 'sales.inbound_sla', every: 300_000 })
  inboundSla(): Promise<number> {
    return this.inbound.breachDue();
  }
}
