import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { WebhooksService } from './webhooks.service';

/** B2B webhook deliveries in the worker (U2.7, D-291). */
@Injectable()
export class B2bJobs {
  constructor(private readonly webhooks: WebhooksService) {}

  /** Due deliveries (new ones and retries after their back-off). */
  @ScheduledJob({ name: 'b2b.webhook_deliveries', every: 30_000 })
  deliver(): Promise<number> {
    return this.webhooks.deliverDue();
  }
}
