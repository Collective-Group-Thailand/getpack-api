import { Global, Module } from '@nestjs/common';

import { ArtworkService } from './artwork.service';
import { MockupsService } from './mockups.service';
import { PreflightService } from './preflight/preflight.service';
import { ProductionCopiesService } from './production-copies.service';
import { ProofsService } from './proofs.service';

/** Artwork submissions, preflight (D-070, ADR-0009), proofs and design services (B4.1). */
@Global()
@Module({
  providers: [ArtworkService, PreflightService, ProofsService, MockupsService, ProductionCopiesService],
  exports: [ArtworkService, PreflightService, ProofsService, MockupsService, ProductionCopiesService],
})
export class ArtworkModule {}
