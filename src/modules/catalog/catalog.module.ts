import { Global, Module } from '@nestjs/common';

import { CatalogCrudService } from './crud/catalog-crud.service';
import { CatalogImportsService } from './imports/imports.service';
import { ProductStructureService } from './product-structure/product-structure.service';
import { StockProductsService } from './stock/stock.service';
import { StoreCatalogService } from './store/store-catalog.service';
import { StoreConfiguratorService } from './store/store-configurator.service';
import { StoreMediaService } from './store/store-media.service';

/** Catalogue & CMS context (schema-design §3.3, B2.1): services shared by the admin and store surfaces. */
@Global()
@Module({
  providers: [
    CatalogCrudService,
    ProductStructureService,
    StockProductsService,
    CatalogImportsService,
    StoreCatalogService,
    StoreConfiguratorService,
    StoreMediaService,
  ],
  exports: [
    CatalogCrudService,
    ProductStructureService,
    StockProductsService,
    CatalogImportsService,
    StoreCatalogService,
    StoreConfiguratorService,
    StoreMediaService,
  ],
})
export class CatalogModule {}
