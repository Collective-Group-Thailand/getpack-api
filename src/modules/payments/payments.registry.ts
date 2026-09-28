import { type Type } from '@nestjs/common';

import {
  AdminPaymentsController,
  PaymentWebhooksController,
  StorePaymentsController,
} from './payments.controller';
import { AdminRefundsController } from './refunds.controller';

export const PAYMENTS_STORE_CONTROLLERS: Type<unknown>[] = [StorePaymentsController];
export const PAYMENTS_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminPaymentsController, AdminRefundsController];
export const PAYMENTS_WEBHOOK_CONTROLLERS: Type<unknown>[] = [PaymentWebhooksController];
