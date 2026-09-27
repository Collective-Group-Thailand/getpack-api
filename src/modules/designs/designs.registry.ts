import { type Type } from '@nestjs/common';

import { AdminDesignsController, StoreDesignsController } from './designs.controller';

export const DESIGNS_STORE_CONTROLLERS: Type<unknown>[] = [StoreDesignsController];
export const DESIGNS_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminDesignsController];
