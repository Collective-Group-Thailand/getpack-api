import { type Type } from '@nestjs/common';

import { AdminDielinesController, StoreDielinesController } from './dieline-downloads.controller';
import {
  AdminFactoryProcessCapabilitiesController,
  AdminProcessCapabilityDecisionsController,
  AdminProcessTypesController,
  AdminStyleCoverageController,
  AdminStyleProcessRulesController,
  PartnerFactoryProcessCapabilitiesController,
  PartnerProcessTypesController,
} from './process-capabilities.controller';
import {
  AdminStructuralRequestsController,
  StoreStructuralRequestsController,
} from './structural-requests.controller';
import { AdminStyleIntakesController, PartnerStyleIntakesController } from './style-intakes.controller';
import { AdminStylePriceRulesController } from './style-price-rules';
import { AdminStyleImportsController, AdminStylesController } from './styles-admin.controller';
import { StoreStyleFavouritesController, StoreStylesController } from './styles-store.controller';

/** `/v1/store/*` controllers of the style library. */
export const STYLES_STORE_CONTROLLERS: Type<unknown>[] = [
  StoreStylesController,
  StoreStyleFavouritesController,
  StoreDielinesController,
  StoreStructuralRequestsController,
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
  AdminDielinesController,
  AdminStyleIntakesController,
  AdminStructuralRequestsController,
];

/** `/v1/partner/*` controllers of the style library. */
export const STYLES_PARTNER_CONTROLLERS: Type<unknown>[] = [
  PartnerProcessTypesController,
  PartnerFactoryProcessCapabilitiesController,
  PartnerStyleIntakesController,
];
