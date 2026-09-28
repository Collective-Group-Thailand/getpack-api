import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { OpsSignalsService } from './ops-signals.service';

@Injectable()
export class OpsJobs {
  constructor(private readonly signals: OpsSignalsService) {}

  /** Operational alerts (B6.3): signals past their threshold notify superadmins and admins. */
  @ScheduledJob({ name: 'ops.alerts', every: 5 * 60_000 })
  alerts(): Promise<number> {
    return this.signals.raiseAlerts();
  }
}
