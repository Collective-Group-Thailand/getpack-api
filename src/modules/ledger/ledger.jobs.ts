import { addMonths } from '@common/ledger-core/dates';
import { bangkokDate } from '@common/time/bangkok';
import { Injectable } from '@nestjs/common';
import { EntitiesService } from '@platform/entities/entities.service';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { ManualJournalsService } from './manual-journals.service';
import { PeriodsService } from './periods.service';
import { RecurringJournalsService } from './recurring-journals.service';

/** Ledger housekeeping in the worker (B5.1). */
@Injectable()
export class LedgerJobs {
  constructor(
    private readonly journals: ManualJournalsService,
    private readonly recurring: RecurringJournalsService,
    private readonly periods: PeriodsService,
    private readonly entities: EntitiesService,
  ) {}

  /** Auto-reversing journals post their reversal on the day set (accruals). */
  @ScheduledJob({ name: 'ledger.auto_reverse', cron: '15 0 * * *' })
  autoReverse(): Promise<number> {
    return this.journals.autoReverseDue();
  }

  /** Recurring journals post on their run day. */
  @ScheduledJob({ name: 'ledger.recurring', cron: '30 0 * * *' })
  recurringRun(): Promise<number> {
    return this.recurring.runDue();
  }

  /** This month's and next month's periods exist before anything posts into them. */
  @ScheduledJob({ name: 'ledger.ensure_periods', cron: '5 0 * * *' })
  async ensurePeriods(): Promise<number> {
    const entityId = await this.entities.defaultEntityId();
    const today = bangkokDate(new Date());
    await this.periods.periodOf(entityId, today);
    await this.periods.periodOf(entityId, addMonths(today, 1));
    return 2;
  }
}
