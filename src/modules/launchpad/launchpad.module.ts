import { Global, Module } from '@nestjs/common';

import { LaunchpadService } from './launchpad.service';

/** Context & personalisation (U5.B1): the signed-in launchpad and the pre-fill defaults (D-297, D-298). */
@Global()
@Module({
  providers: [LaunchpadService],
  exports: [LaunchpadService],
})
export class LaunchpadModule {}
