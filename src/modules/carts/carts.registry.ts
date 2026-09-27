import { type Type } from '@nestjs/common';

import { AdminCartController, StoreCartController } from './carts.controller';

/** `/v1/store/*` controllers of the carts context. */
export const CARTS_STORE_CONTROLLERS: Type<unknown>[] = [StoreCartController];

/** `/v1/admin/*` controllers of the carts context. */
export const CARTS_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminCartController];
