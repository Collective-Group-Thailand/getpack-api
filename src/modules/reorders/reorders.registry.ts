import { type Type } from '@nestjs/common';

import {
  AdminReorderSuggestionsController,
  StoreReorderSuggestionsController,
} from './reorder-suggestions.controller';

/** `/v1/store/*` controllers of repeat business. */
export const REORDERS_STORE_CONTROLLERS: Type<unknown>[] = [StoreReorderSuggestionsController];

/** `/v1/admin/*` controllers of repeat business. */
export const REORDERS_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminReorderSuggestionsController];
