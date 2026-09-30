import { type Type } from '@nestjs/common';

import { AdminOrderListController } from './admin-orders.controller';
import { AdminOrderOperationsController } from './order-operations.controller';
import { AdminOrdersController, StoreOrdersController } from './orders.controller';

/** `/v1/store/*` controllers of orders. */
export const ORDERS_STORE_CONTROLLERS: Type<unknown>[] = [StoreOrdersController];

/** `/v1/admin/*` controllers of orders. */
export const ORDERS_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminOrdersController,
  AdminOrderOperationsController,
  AdminOrderListController,
];
