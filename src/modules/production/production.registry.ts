import { type Type } from '@nestjs/common';

import { PartnerCountersController } from './factory-counters';
import { PartnerFactoryUsersController } from './factory-users.controller';
import { AdminOversightController, PartnerScorecardsController } from './oversight.controller';
import { PartnerProductionController, PartnerShopFloorController } from './partner-production.controller';
import { AdminMilestoneRoutesController, AdminProductionController } from './production.controller';

export const PRODUCTION_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminProductionController,
  AdminMilestoneRoutesController,
  AdminOversightController,
];
export const PRODUCTION_PARTNER_CONTROLLERS: Type<unknown>[] = [
  PartnerProductionController,
  PartnerFactoryUsersController,
  PartnerScorecardsController,
  PartnerShopFloorController,
  PartnerCountersController,
];
