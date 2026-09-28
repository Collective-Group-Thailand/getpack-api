import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { ProspectusService } from './prospectus.service';
import { AnalyticsRollupService } from './rollups.service';

@Injectable()
export class AnalyticsJobs {
  constructor(
    private readonly rollups: AnalyticsRollupService,
    private readonly prospectus: ProspectusService,
  ) {}

  /** Nightly rollups (B6.1): yesterday and the unpaid-expiry window before it (Asia/Bangkok). */
  @ScheduledJob({ name: 'analytics.rollup_nightly', cron: '30 2 * * *' })
  nightly(): Promise<number> {
    return this.rollups.nightly();
  }

  /** Backfills queued by admins. */
  @ScheduledJob({ name: 'analytics.rollup_queue', every: 60_000 })
  queued(): Promise<number> {
    return this.rollups.processQueue();
  }

  /** Partner prospectus PDFs and workbooks (D-102). */
  @ScheduledJob({ name: 'analytics.prospectus', every: 60_000 })
  prospectusExports(): Promise<number> {
    return this.prospectus.processPending();
  }
}
