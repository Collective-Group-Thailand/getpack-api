import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { StorageMeteringService } from './storage-metering.service';

/** Storage metering in the worker (D-436). */
@Injectable()
export class StorageJobs {
  constructor(private readonly metering: StorageMeteringService) {}

  /** Nightly: every factory account's usage of the day, and the 80 % / 100 % notices. */
  @ScheduledJob({ name: 'storage.snapshot', cron: '10 3 * * *' })
  snapshot(): Promise<number> {
    return this.metering.snapshotAll();
  }
}
