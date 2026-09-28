import { type Type } from '@nestjs/common';

import { AdminPayoutsController, PartnerPayoutsController } from './payouts.controller';

export const PAYOUTS_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminPayoutsController];
export const PAYOUTS_PARTNER_CONTROLLERS: Type<unknown>[] = [PartnerPayoutsController];
