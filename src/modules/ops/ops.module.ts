import { Global, Module } from '@nestjs/common';

import { DashboardService } from './dashboard.service';
import { OpsJobs } from './ops.jobs';
import { OpsSignalsService } from './ops-signals.service';
import { RumService } from './rum.service';

/** Launch readiness (B6.3): operational signals, alerts through the notification matrix. */
@Global()
@Module({
  providers: [OpsSignalsService, OpsJobs, RumService, DashboardService],
  exports: [OpsSignalsService, RumService, DashboardService],
})
export class OpsModule {}
