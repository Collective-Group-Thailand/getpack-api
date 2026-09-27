import { type Type } from '@nestjs/common';

import { AdminPaymentsController, PaymentWebhooksController, StorePaymentsController } from './payments.controller';

export const PAYMENTS_STORE_CONTROLLERS: Type<unknown>[] = [StorePaymentsController];
export const PAYMENTS_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminPaymentsController];
export const PAYMENTS_WEBHOOK_CONTROLLERS: Type<unknown>[] = [PaymentWebhooksController];
