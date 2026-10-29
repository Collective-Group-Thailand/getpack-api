import { Global, Module } from '@nestjs/common';

import { ArtworkService } from './artwork.service';
import { FileCheckRetention } from './file-checks/file-check-retention';
import { FileChecksService } from './file-checks/file-checks.service';
import { FileChecksCheckout } from './file-checks/file-checks-checkout.extension';
import { MockupsService } from './mockups.service';
import { PreflightService } from './preflight/preflight.service';
import { ProductionCopiesService } from './production-copies.service';
import { ProofsService } from './proofs.service';

/** Artwork submissions, preflight (D-070, ADR-0009), proofs and design services (B4.1), file checks before ordering (D-457) and the purge of
 * their unordered files (D-459). */
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
    FileCheckRetention,
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
