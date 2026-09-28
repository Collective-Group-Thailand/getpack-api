import { type Type } from '@nestjs/common';

import { AdminPayablesController, PartnerPayablesController } from './payables.controller';

export const PAYABLES_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminPayablesController];
export const PAYABLES_PARTNER_CONTROLLERS: Type<unknown>[] = [PartnerPayablesController];
