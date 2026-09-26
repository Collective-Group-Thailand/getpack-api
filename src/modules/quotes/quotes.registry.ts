import { type Type } from '@nestjs/common';

import { AdminQuotesController, StoreSavedQuotesController } from './quotes.controller';

/** `/v1/store/*` controllers of the quotes context. */
export const QUOTES_STORE_CONTROLLERS: Type<unknown>[] = [StoreSavedQuotesController];

/** `/v1/admin/*` controllers of the quotes context. */
export const QUOTES_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminQuotesController];

/** `/v1/partner/*` controllers of the quotes context. */
export const QUOTES_PARTNER_CONTROLLERS: Type<unknown>[] = [];
