import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { CreditService } from './credit.service';

/** B2B credit housekeeping in the worker. */
@Injectable()
export class CompaniesJobs {
  constructor(private readonly credit: CreditService) {}

  /** Due reminders and the overdue block (D-122). */
  @ScheduledJob({ name: 'companies.dunning', every: 3_600_000 })
  dunning() {
    return this.credit.runDunning();
  }

  /** `company.statement_ready` for last month, checked daily (D-125). */
  @ScheduledJob({ name: 'companies.statements', every: 86_400_000 })
  statements(): Promise<number> {
    return this.credit.statementsReady();
  }
}
