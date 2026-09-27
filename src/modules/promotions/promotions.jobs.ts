import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { PromotionRedemptions } from './promotion-redemptions.service';

/** Promotion housekeeping in the worker. */
@Injectable()
export class PromotionsJobs {
  constructor(private readonly redemptions: PromotionRedemptions) {}

  /** Scheduled campaigns start and campaigns / promotions end on their dates (D-053 window, D-154). */
  @ScheduledJob({ name: 'promotions.refresh_windows', every: 60_000 })
  refreshWindows(): Promise<number> {
    return this.redemptions.refreshWindows();
  }
}
