import { type Type } from '@nestjs/common';

import { AdminCheckoutController, StoreCheckoutController } from './checkout.controller';

/** `/v1/store/*` controllers of checkout. */
export const CHECKOUT_STORE_CONTROLLERS: Type<unknown>[] = [StoreCheckoutController];

/** `/v1/admin/*` controllers of checkout. */
export const CHECKOUT_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminCheckoutController];
