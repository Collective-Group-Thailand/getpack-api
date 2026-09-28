import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { ReportsService } from './reports.service';

@Injectable()
export class ReportsJobs {
  constructor(private readonly reports: ReportsService) {}

  /** Schedules that are due queue their run (B6.2). */
  @ScheduledJob({ name: 'reports.schedules', every: 60_000 })
  schedules(): Promise<number> {
    return this.reports.queueDue();
  }

  /** Report files requested or scheduled. */
  @ScheduledJob({ name: 'reports.runs', every: 15_000 })
  runs(): Promise<number> {
    return this.reports.processRuns();
  }
}
