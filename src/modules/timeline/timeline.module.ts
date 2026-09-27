import { Global, Module } from '@nestjs/common';

import { RealtimeFanout } from './realtime-fanout.subscriber';
import { TimelineService } from './timeline.service';

const SERVICES = [TimelineService, RealtimeFanout];

/** Order timelines, promised vs actual, public tracking and the realtime fan-out (D-143, B4.4). */
@Global()
@Module({ providers: SERVICES, exports: SERVICES })
export class TimelineModule {}
