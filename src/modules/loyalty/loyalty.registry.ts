import { type Type } from '@nestjs/common';

import {
  AdminLoyaltyController,
  AdminReviewsController,
  StoreLoyaltyController,
  StoreReviewsController,
} from './loyalty.controller';

export const LOYALTY_STORE_CONTROLLERS: Type<unknown>[] = [StoreLoyaltyController, StoreReviewsController];
export const LOYALTY_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminLoyaltyController, AdminReviewsController];
