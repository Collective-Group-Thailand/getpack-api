import { Global, Module } from '@nestjs/common';

import { CatalogCrudService } from './crud/catalog-crud.service';
import { GeometryService } from './geometry/geometry.service';
import { CatalogImportsService } from './imports/imports.service';
import { KnowledgeBaseService } from './knowledge-base/knowledge-base';
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
    GeometryService,
    StockProductsService,
    CatalogImportsService,
    StoreCatalogService,
    StoreConfiguratorService,
    StoreMediaService,
    KnowledgeBaseService,
  ],
  exports: [
    CatalogCrudService,
    ProductStructureService,
    GeometryService,
    StockProductsService,
    CatalogImportsService,
    StoreCatalogService,
    StoreConfiguratorService,
    StoreMediaService,
    KnowledgeBaseService,
  ],
})
export class CatalogModule {}
