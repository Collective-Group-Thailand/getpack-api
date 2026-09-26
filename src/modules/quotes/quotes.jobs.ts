import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { SavedQuotesService } from './saved-quotes.service';

/** Quote housekeeping in the worker. */
@Injectable()
export class QuotesJobs {
  constructor(private readonly quotes: SavedQuotesService) {}

  /** Live quotes past their validity become `expired` (D-051). */
  @ScheduledJob({ name: 'quotes.expire', every: 5 * 60_000 })
  expire(): Promise<number> {
    return this.quotes.expireDue();
  }
}
