import { type Type } from '@nestjs/common';

import {
  ArticleActionsController,
  FaqActionsController,
  HomeSectionActionsController,
  SemiDesignActionsController,
  SemiDesignTemplateActionsController,
} from './cms/cms.controller';
import {
  articleCategories,
  articles,
  banners,
  faqCategories,
  faqs,
  glossaryTerms,
  homeSections,
  seoPages,
  videos,
} from './cms/cms.resources';
import { catalogCrudController } from './crud/catalog-crud.controller';
import { type AnyCatalogResource } from './crud/catalog-resource';
import { geoDistricts, geoProvinces, geoSubdistricts } from './geography/geography.resources';
import {
  GeometryBandTableActionsController,
  PatternGeometryController,
} from './geometry/geometry.controller';
import { geometryBandTables, geometryConditions } from './geometry/geometry.resources';
import { CatalogImportsController } from './imports/imports.controller';
import { PartnerKnowledgeBaseController } from './knowledge-base/knowledge-base';
import {
  assemblies,
  assemblyGroups,
  diecutGroups,
  diecutTypes,
  difficultyLevelGroups,
  difficultyLevels,
  finishes,
  finishGroups,
  fluteTypes,
  foilTypes,
  inkColourGroups,
  inkColours,
  materialFamilies,
  materials,
  packingTypes,
  specTitles,
} from './materials/materials.resources';
import {
  CatalogProductRelationsController,
  PatternRelationsController,
  ProductTypeActionsController,
} from './product-structure/product-structure.controller';
import {
  catalogProducts,
  patterns,
  printTypes,
  productCategories,
  productTypes,
  standardSizes,
  subPatterns,
} from './product-structure/product-structure.resources';
import {
  designFonts,
  semiDesigns,
  semiDesignTemplates,
  showcaseCategories,
  showcaseProducts,
} from './showcase/showcase.resources';
import { StockProductRelationsController } from './stock/stock.controller';
import { stockAttributeValues, stockProducts } from './stock/stock.resources';

/** Every admin-editable catalogue / CMS / geography resource (B2.1). */
export const CATALOG_RESOURCES: readonly AnyCatalogResource[] = [
  productCategories,
  productTypes,
  printTypes,
  catalogProducts,
  standardSizes,
  patterns,
  subPatterns,
  geometryBandTables,
  geometryConditions,
  materialFamilies,
  fluteTypes,
  materials,
  finishGroups,
  finishes,
  foilTypes,
  inkColourGroups,
  inkColours,
  diecutGroups,
  diecutTypes,
  assemblyGroups,
  assemblies,
  difficultyLevelGroups,
  difficultyLevels,
  packingTypes,
  specTitles,
  stockAttributeValues,
  stockProducts,
  showcaseCategories,
  showcaseProducts,
  semiDesigns,
  semiDesignTemplates,
  designFonts,
  banners,
  homeSections,
  articleCategories,
  articles,
  faqCategories,
  faqs,
  glossaryTerms,
  seoPages,
  videos,
  geoProvinces,
  geoDistricts,
  geoSubdistricts,
];

/**
 * `/v1/admin/{catalog|cms|geography}/*` controllers. Action controllers come first so their fixed
 * segments (`actions/…`, `patterns`, `options`) are matched before the generic `:id` routes.
 */
export const CATALOG_ADMIN_CONTROLLERS: Type<unknown>[] = [
  CatalogImportsController,
  ProductTypeActionsController,
  CatalogProductRelationsController,
  PatternRelationsController,
  PatternGeometryController,
  GeometryBandTableActionsController,
  StockProductRelationsController,
  HomeSectionActionsController,
  ArticleActionsController,
  FaqActionsController,
  SemiDesignActionsController,
  SemiDesignTemplateActionsController,
  ...CATALOG_RESOURCES.map(catalogCrudController),
];

/** `/v1/partner/*` controllers of the catalogue & CMS: the partner knowledge base (D-295). */
export const CATALOG_PARTNER_CONTROLLERS: Type<unknown>[] = [PartnerKnowledgeBaseController];
