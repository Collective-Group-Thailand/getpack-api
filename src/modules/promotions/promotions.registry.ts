import { type Type } from '@nestjs/common';

import { AdminCartCodesController, StoreCartCodesController } from './promotion-codes.controller';
import { AdminCampaignsController, AdminPromotionsController } from './promotions.controller';
import { AdminReferralsController, StoreReferralController } from './referrals.controller';

export const PROMOTIONS_STORE_CONTROLLERS: Type<unknown>[] = [StoreCartCodesController, StoreReferralController];
export const PROMOTIONS_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminCampaignsController,
  AdminPromotionsController,
  AdminCartCodesController,
  AdminReferralsController,
];
