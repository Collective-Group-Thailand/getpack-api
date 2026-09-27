import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { LoyaltyService } from './loyalty.service';

/** Loyalty housekeeping in the worker. */
@Injectable()
export class LoyaltyJobs {
  constructor(private readonly loyalty: LoyaltyService) {}

  /** Earnings past their claim window are credited (D-132). */
  @ScheduledJob({ name: 'loyalty.credit_due', every: 3_600_000 })
  creditDue(): Promise<number> {
    return this.loyalty.creditDue();
  }

  /** Lots past 12 months expire (D-132, P12). */
  @ScheduledJob({ name: 'loyalty.expire', every: 3_600_000 })
  expire(): Promise<number> {
    return this.loyalty.expireDue();
  }

  /** One reminder per lot 30 days before it expires (D-132). */
  @ScheduledJob({ name: 'loyalty.remind_expiring', every: 3_600_000 })
  remind(): Promise<number> {
    return this.loyalty.remindExpiring();
  }

  /** Tiers from 12-month spend, nightly (D-134). */
  @ScheduledJob({ name: 'loyalty.recalculate_tiers', every: 86_400_000 })
  recalculateTiers(): Promise<number> {
    return this.loyalty.recalculateTiers();
  }
}
