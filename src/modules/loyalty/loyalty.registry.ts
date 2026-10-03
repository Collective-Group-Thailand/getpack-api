import { type Type } from '@nestjs/common';

import {
  AdminLoyaltyController,
  AdminReviewsController,
  StoreLoyaltyController,
  StorePublicReviewsController,
  StoreReviewsController,
} from './loyalty.controller';

export const LOYALTY_STORE_CONTROLLERS: Type<unknown>[] = [
  StoreLoyaltyController,
  StoreReviewsController,
  StorePublicReviewsController,
];
export const LOYALTY_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminLoyaltyController, AdminReviewsController];
