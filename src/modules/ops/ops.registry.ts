import { type Type } from '@nestjs/common';

import { AdminOpsController } from './ops.controller';
import {
  AdminRumController,
  AdminWebVitalsController,
  PartnerRumController,
  StoreRumController,
} from './rum.controller';

export const OPS_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminOpsController,
  AdminWebVitalsController,
  AdminRumController,
];
export const OPS_STORE_CONTROLLERS: Type<unknown>[] = [StoreRumController];
export const OPS_PARTNER_CONTROLLERS: Type<unknown>[] = [PartnerRumController];
