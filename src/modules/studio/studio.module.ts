import { Global, Module } from '@nestjs/common';

import { CollaborationService } from './collaboration.service';
import { StudioCatalogService } from './studio-catalog.service';
import { StudioCheckout } from './studio-checkout.extension';
import { StudioChecksService } from './studio-checks.service';
import { StudioPrintService } from './studio-print.service';
import { StudioQuotesService } from './studio-quotes.service';

/**
 * The studio backend (U4, D-275–D-286): quote from design, print-check rules, the print file and order hand-off,
 * brand kits / templates / elements, collaboration and the design-service hand-off.
 */
@Global()
@Module({
  providers: [
    StudioQuotesService,
    StudioChecksService,
    StudioPrintService,
    StudioCheckout,
    StudioCatalogService,
    CollaborationService,
  ],
  exports: [
    StudioQuotesService,
    StudioChecksService,
    StudioPrintService,
    StudioCatalogService,
    CollaborationService,
  ],
})
export class StudioModule {}
