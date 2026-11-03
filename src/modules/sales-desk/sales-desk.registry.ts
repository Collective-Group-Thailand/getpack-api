import { type Type } from '@nestjs/common';

import { AdminSalesDashboardController } from './sales-dashboard';
import { AdminSalesInboundController } from './sales-inbound.controller';
import {
  AdminSalesLeadsController,
  AdminSalesQuotesController,
  AdminSalesRepsController,
} from './sales-pipeline.controller';

export const SALES_DESK_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminSalesLeadsController,
  AdminSalesQuotesController,
  AdminSalesRepsController,
  AdminSalesInboundController,
  AdminSalesDashboardController,
];
