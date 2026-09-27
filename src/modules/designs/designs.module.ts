import { Global, Module } from '@nestjs/common';

import { DesignsService } from './designs.service';
import { DrawingsService } from './drawings.service';

/** Online designs (versions, ETag, assets, templates) and dieline drawings (`@packio/dieline`, B4.1). */
@Global()
@Module({
  providers: [DesignsService, DrawingsService],
  exports: [DesignsService, DrawingsService],
})
export class DesignsModule {}
