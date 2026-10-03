import { type Type } from '@nestjs/common';

import {
  AdminFactoryProcessCapabilitiesController,
  AdminProcessCapabilityDecisionsController,
  AdminProcessTypesController,
  AdminStyleCoverageController,
  AdminStyleProcessRulesController,
  PartnerFactoryProcessCapabilitiesController,
  PartnerProcessTypesController,
} from './process-capabilities.controller';
import { AdminStylePriceRulesController } from './style-price-rules';
import { AdminStyleImportsController, AdminStylesController } from './styles-admin.controller';
import { StoreStyleFavouritesController, StoreStylesController } from './styles-store.controller';

/** `/v1/store/*` controllers of the style library. */
export const STYLES_STORE_CONTROLLERS: Type<unknown>[] = [
  StoreStylesController,
  StoreStyleFavouritesController,
];

/** `/v1/admin/*` controllers of the style library. */
export const STYLES_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminStylesController,
  AdminStyleImportsController,
  AdminProcessTypesController,
  AdminFactoryProcessCapabilitiesController,
  AdminProcessCapabilityDecisionsController,
  AdminStyleProcessRulesController,
  AdminStyleCoverageController,
  AdminStylePriceRulesController,
];

/** `/v1/partner/*` controllers of the style library. */
export const STYLES_PARTNER_CONTROLLERS: Type<unknown>[] = [
  PartnerProcessTypesController,
  PartnerFactoryProcessCapabilitiesController,
];
