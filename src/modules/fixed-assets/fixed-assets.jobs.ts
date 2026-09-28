import { bangkokDate } from '@common/time/bangkok';
import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { FixedAssetsService } from './fixed-assets.service';

/** Monthly depreciation in the worker (D-150): last month's run on the 1st, when not yet run and still open. */
@Injectable()
export class FixedAssetsJobs {
  constructor(private readonly assets: FixedAssetsService) {}

  @ScheduledJob({ name: 'fixed_assets.depreciation', cron: '0 6 1 * *' })
  run(): Promise<number> {
    return this.assets.runDue(bangkokDate(new Date()));
  }
}
