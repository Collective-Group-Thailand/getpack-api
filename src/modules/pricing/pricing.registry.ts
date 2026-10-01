import { type Type } from '@nestjs/common';

import { StorePriceHintsController } from './hints/price-hints.controller';
import {
  AdminCsCorrugateController,
  AdminCsFoldingController,
  AdminCsLabelController,
  AdminCsTagSleeveController,
  PartnerCorrugatePricingController,
  PartnerFoldingPricingController,
  PartnerLabelPricingController,
  PartnerTagSleevePricingController,
  StoreQuotesController,
} from './quotes/quotes.controller';
import { SellMarginTablesController } from './sell-margins/sell-margins.controller';

/** `/v1/store/*` controllers of the pricing context. */
export const PRICING_STORE_CONTROLLERS: Type<unknown>[] = [StoreQuotesController, StorePriceHintsController];

/** `/v1/admin/*` controllers of the pricing context. */
export const PRICING_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminCsFoldingController,
  AdminCsCorrugateController,
  AdminCsLabelController,
  AdminCsTagSleeveController,
  SellMarginTablesController,
];

/** `/v1/partner/*` controllers of the pricing context (own factory only, D-044). */
export const PRICING_PARTNER_CONTROLLERS: Type<unknown>[] = [
  PartnerFoldingPricingController,
  PartnerCorrugatePricingController,
  PartnerLabelPricingController,
  PartnerTagSleevePricingController,
];
