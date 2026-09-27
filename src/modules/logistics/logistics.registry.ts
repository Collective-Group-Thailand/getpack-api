import { type Type } from '@nestjs/common';

import {
  AdminShipmentsController,
  PartnerShipmentsController,
  StoreShipmentsController,
} from './logistics.controller';

export const LOGISTICS_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminShipmentsController];
export const LOGISTICS_PARTNER_CONTROLLERS: Type<unknown>[] = [PartnerShipmentsController];
export const LOGISTICS_STORE_CONTROLLERS: Type<unknown>[] = [StoreShipmentsController];
