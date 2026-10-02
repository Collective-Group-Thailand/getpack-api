import { type Type } from '@nestjs/common';

import { AdminStyleImportsController, AdminStylesController } from './styles-admin.controller';
import { StoreStyleFavouritesController, StoreStylesController } from './styles-store.controller';

/** `/v1/store/*` controllers of the style library. */
export const STYLES_STORE_CONTROLLERS: Type<unknown>[] = [
  StoreStylesController,
  StoreStyleFavouritesController,
];

/** `/v1/admin/*` controllers of the style library. */
export const STYLES_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminStylesController, AdminStyleImportsController];

/** `/v1/partner/*` controllers of the style library. */
export const STYLES_PARTNER_CONTROLLERS: Type<unknown>[] = [];
