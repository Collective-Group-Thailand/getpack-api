import { type Type } from '@nestjs/common';

import { AdminOrderListController } from './admin-orders.controller';
import { AdminOrderOperationsController } from './order-operations.controller';
import { AdminOrdersController, StoreOrdersController } from './orders.controller';
import {
  AdminSpecSheetController,
  PartnerSpecSheetController,
  StoreSpecSheetController,
} from './spec-sheet.controller';

/** `/v1/store/*` controllers of orders. */
export const ORDERS_STORE_CONTROLLERS: Type<unknown>[] = [StoreOrdersController, StoreSpecSheetController];

/** `/v1/partner/*` controllers of orders. */
export const ORDERS_PARTNER_CONTROLLERS: Type<unknown>[] = [PartnerSpecSheetController];

/** `/v1/admin/*` controllers of orders. */
export const ORDERS_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminOrdersController,
  AdminOrderOperationsController,
  AdminOrderListController,
  AdminSpecSheetController,
];
