import { Global, Module } from '@nestjs/common';

import { ArtworkService } from './artwork.service';
import { FileChecksService } from './file-checks/file-checks.service';
import { FileChecksCheckout } from './file-checks/file-checks-checkout.extension';
import { MockupsService } from './mockups.service';
import { PreflightService } from './preflight/preflight.service';
import { ProductionCopiesService } from './production-copies.service';
import { ProofsService } from './proofs.service';

/** Artwork submissions, preflight (D-070, ADR-0009), proofs and design services (B4.1), file checks before ordering (D-457). */
@Global()
@Module({
  providers: [
    ArtworkService,
    PreflightService,
    ProofsService,
    MockupsService,
    ProductionCopiesService,
    FileChecksService,
    FileChecksCheckout,
  ],
  exports: [
    ArtworkService,
    PreflightService,
    ProofsService,
    MockupsService,
    ProductionCopiesService,
    FileChecksService,
  ],
})
export class ArtworkModule {}
