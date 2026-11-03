import { type Type } from '@nestjs/common';

import { AdminDiscountApprovalsController } from './discount-approvals.controller';
import { AdminSalesDashboardController } from './sales-dashboard';
import { AdminSalesInboundController } from './sales-inbound.controller';
import { AdminSalesNegotiationsController } from './sales-negotiations';
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
  AdminDiscountApprovalsController,
  AdminSalesNegotiationsController,
];
