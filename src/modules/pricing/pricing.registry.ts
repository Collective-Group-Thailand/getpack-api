import { StoreSpecsController } from '@modules/specs/specs.controller';
import { type Type } from '@nestjs/common';

import { StorePriceHintsController } from './hints/price-hints.controller';
import { StoreHeroPresetsController } from './quotes/hero-presets.controller';
import {
  AdminCsCorrugateController,
  AdminCsFoldingController,
  AdminCsLabelController,
  AdminCsPouchController,
  AdminCsServiceController,
  AdminCsStandardProductController,
  AdminCsTagSleeveController,
  PartnerCorrugatePricingController,
  PartnerFoldingPricingController,
  PartnerLabelPricingController,
  PartnerPouchPricingController,
  PartnerServicePricingController,
  PartnerStandardProductPricingController,
  PartnerTagSleevePricingController,
  StoreQuotesController,
} from './quotes/quotes.controller';
import { SellMarginTablesController } from './sell-margins/sell-margins.controller';

/** `/v1/store/*` controllers of the pricing context. */
export const PRICING_STORE_CONTROLLERS: Type<unknown>[] = [
  StoreQuotesController,
  StorePriceHintsController,
  StoreSpecsController,
  StoreHeroPresetsController,
];

/** `/v1/admin/*` controllers of the pricing context. */
export const PRICING_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminCsFoldingController,
  AdminCsCorrugateController,
  AdminCsLabelController,
  AdminCsTagSleeveController,
  AdminCsPouchController,
  AdminCsStandardProductController,
  AdminCsServiceController,
  SellMarginTablesController,
];

/** `/v1/partner/*` controllers of the pricing context (own factory only, D-044). */
export const PRICING_PARTNER_CONTROLLERS: Type<unknown>[] = [
  PartnerFoldingPricingController,
  PartnerCorrugatePricingController,
  PartnerLabelPricingController,
  PartnerTagSleevePricingController,
  PartnerPouchPricingController,
  PartnerStandardProductPricingController,
  PartnerServicePricingController,
];
