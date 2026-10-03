import { Global, Module } from '@nestjs/common';

import { DesignerCatalogService } from './designer-catalog.service';
import { DesignsService } from './designs.service';
import { DesignsCheckout } from './designs-checkout.extension';
import { DrawingsService } from './drawings.service';

/** Online designs (versions, ETag, assets, templates) and dieline drawings (`@packio/dieline`, B4.1). */
@Global()
@Module({
  providers: [DesignsService, DrawingsService, DesignerCatalogService, DesignsCheckout],
  exports: [DesignsService, DrawingsService, DesignerCatalogService],
})
export class DesignsModule {}
