import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { ConfigurationDraftsService } from './configuration-drafts.service';
import { SavedQuotesService } from './saved-quotes.service';

/** Quote housekeeping in the worker. */
@Injectable()
export class QuotesJobs {
  constructor(
    private readonly quotes: SavedQuotesService,
    private readonly drafts: ConfigurationDraftsService,
  ) {}

  /** Live quotes past their validity become `expired` (D-051). */
  @ScheduledJob({ name: 'quotes.expire', every: 5 * 60_000 })
  expire(): Promise<number> {
    return this.quotes.expireDue();
  }

  /** Draft configurations past their retention are deleted (D-185, `configurations.draft_retention_days`). */
  @ScheduledJob({ name: 'configurations.purge_drafts', every: 6 * 60 * 60_000 })
  purgeDrafts(): Promise<number> {
    return this.drafts.purgeExpired();
  }
}
