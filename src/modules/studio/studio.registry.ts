import { type Type } from '@nestjs/common';

import { StoreStudioController } from './studio.controller';
import {
  AdminStudioElementsController,
  AdminStudioTemplatesController,
  StoreBrandKitsController,
  StoreStudioCatalogController,
} from './studio-catalog.controller';

/** `/v1/store/*` controllers of the studio (U4). */
export const STUDIO_STORE_CONTROLLERS: Type<unknown>[] = [
  StoreStudioCatalogController,
  StoreStudioController,
  StoreBrandKitsController,
];

/** `/v1/admin/*` controllers of the studio (U4). */
export const STUDIO_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminStudioTemplatesController,
  AdminStudioElementsController,
];
