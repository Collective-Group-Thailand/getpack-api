import { Global, Module } from '@nestjs/common';

import { OpsJobs } from './ops.jobs';
import { OpsSignalsService } from './ops-signals.service';

/** Launch readiness (B6.3): operational signals, alerts through the notification matrix. */
@Global()
@Module({ providers: [OpsSignalsService, OpsJobs], exports: [OpsSignalsService] })
export class OpsModule {}
