import { type Type } from '@nestjs/common';

import {
  AdminShipmentsController,
  PartnerShipmentsController,
  PartnerShipPlanController,
  StoreShipmentsController,
} from './logistics.controller';

export const LOGISTICS_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminShipmentsController];
export const LOGISTICS_PARTNER_CONTROLLERS: Type<unknown>[] = [
  PartnerShipmentsController,
  PartnerShipPlanController,
];
export const LOGISTICS_STORE_CONTROLLERS: Type<unknown>[] = [StoreShipmentsController];
