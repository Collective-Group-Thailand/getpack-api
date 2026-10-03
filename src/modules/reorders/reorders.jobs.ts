import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { ReorderSuggestionsService } from './reorder-suggestions.service';

/** Reorder suggestions in the worker (U2.7, D-288). */
@Injectable()
export class ReordersJobs {
  constructor(private readonly suggestions: ReorderSuggestionsService) {}

  /** Nightly: every SKU's suggestion from its orders. */
  @ScheduledJob({ name: 'reorder.suggestions', cron: '30 2 * * *' })
  recompute(): Promise<number> {
    return this.suggestions.recompute();
  }

  /** Mornings: the reminders whose date has come (marketing — consent and quiet hours in the router, D-144). */
  @ScheduledJob({ name: 'reorder.reminders', cron: '30 9 * * *' })
  remind(): Promise<number> {
    return this.suggestions.remind();
  }
}
