import { type Type } from '@nestjs/common';

import { StoreLoyaltyController } from './loyalty.controller';

export const LOYALTY_STORE_CONTROLLERS: Type<unknown>[] = [StoreLoyaltyController];
export const LOYALTY_ADMIN_CONTROLLERS: Type<unknown>[] = [];
