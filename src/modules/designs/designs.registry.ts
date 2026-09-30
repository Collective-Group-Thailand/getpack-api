import { type Type } from '@nestjs/common';

import { StoreDesignerCatalogController } from './designer-catalog.controller';
import { AdminDesignsController, StoreDesignsController } from './designs.controller';

export const DESIGNS_STORE_CONTROLLERS: Type<unknown>[] = [StoreDesignsController, StoreDesignerCatalogController];
export const DESIGNS_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminDesignsController];
