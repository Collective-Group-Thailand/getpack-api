import { Global, Module } from '@nestjs/common';

import { StudioCatalogService } from './studio-catalog.service';
import { StudioCheckout } from './studio-checkout.extension';
import { StudioChecksService } from './studio-checks.service';
import { StudioPrintService } from './studio-print.service';
import { StudioQuotesService } from './studio-quotes.service';

/** The studio backend (U4): quote from design (D-277); rules, print files, brand kits and collaboration follow. */
@Global()
@Module({
  providers: [
    StudioQuotesService,
    StudioChecksService,
    StudioPrintService,
    StudioCheckout,
    StudioCatalogService,
  ],
  exports: [StudioQuotesService, StudioChecksService, StudioPrintService, StudioCatalogService],
})
export class StudioModule {}
