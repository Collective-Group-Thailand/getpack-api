import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { TaxCalendarService } from './tax-calendar.service';

/** Tax calendar in the worker (B5.4): each month's due dates, then reminders ahead of them. */
@Injectable()
export class TaxJobs {
  constructor(private readonly calendar: TaxCalendarService) {}

  @ScheduledJob({ name: 'tax.calendar', cron: '0 7 * * *' })
  async run(): Promise<number> {
    return (await this.calendar.ensure()) + (await this.calendar.remind());
  }
}
