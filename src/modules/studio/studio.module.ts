import { Global, Module } from '@nestjs/common';

import { StudioChecksService } from './studio-checks.service';
import { StudioQuotesService } from './studio-quotes.service';

/** The studio backend (U4): quote from design (D-277); rules, print files, brand kits and collaboration follow. */
@Global()
@Module({
  providers: [StudioQuotesService, StudioChecksService],
  exports: [StudioQuotesService, StudioChecksService],
})
export class StudioModule {}
