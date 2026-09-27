import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { PromotionRedemptions } from './promotion-redemptions.service';
import { ReferralsService } from './referrals.service';

/** Promotion housekeeping in the worker. */
@Injectable()
export class PromotionsJobs {
  constructor(
    private readonly redemptions: PromotionRedemptions,
    private readonly referrals: ReferralsService,
  ) {}

  /** Scheduled campaigns start and campaigns / promotions end on their dates (D-053 window, D-154). */
  @ScheduledJob({ name: 'promotions.refresh_windows', every: 60_000 })
  refreshWindows(): Promise<number> {
    return this.redemptions.refreshWindows();
  }

  /** Referrals whose first order passed the claim window are checked and qualified (D-136). */
  @ScheduledJob({ name: 'referrals.qualify', every: 3_600_000 })
  qualifyReferrals(): Promise<number> {
    return this.referrals.qualifyDue();
  }
}
