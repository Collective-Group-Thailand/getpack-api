import { type Type } from '@nestjs/common';

import {
  AdminPaymentSchedulesController,
  StoreInstalmentsController,
  StorePaymentSchedulesController,
} from './payment-schedules.controller';

export const PAYMENT_SCHEDULES_STORE_CONTROLLERS: Type<unknown>[] = [
  StorePaymentSchedulesController,
  StoreInstalmentsController,
];
export const PAYMENT_SCHEDULES_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminPaymentSchedulesController];
