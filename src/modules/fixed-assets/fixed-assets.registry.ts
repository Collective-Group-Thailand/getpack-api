import { type Type } from '@nestjs/common';

import { AdminFixedAssetsController } from './fixed-assets.controller';

export const FIXED_ASSETS_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminFixedAssetsController];
