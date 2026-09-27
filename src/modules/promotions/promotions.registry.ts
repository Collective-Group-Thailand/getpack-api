import { type Type } from '@nestjs/common';

import { AdminCampaignsController, AdminPromotionsController } from './promotions.controller';

export const PROMOTIONS_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminCampaignsController,
  AdminPromotionsController,
];
