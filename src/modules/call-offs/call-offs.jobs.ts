import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { CallOffsService } from './call-offs.service';

/** Call-off housekeeping in the worker (U2.7, D-290). */
@Injectable()
export class CallOffsJobs {
  constructor(private readonly callOffs: CallOffsService) {}

  /** Releases whose quotation expired unordered, agreements past their end, unanswered requests. */
  @ScheduledJob({ name: 'call_offs.lapse', cron: '10 0 * * *' })
  lapse(): Promise<number> {
    return this.callOffs.lapse();
  }
}
