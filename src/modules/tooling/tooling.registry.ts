import { type Type } from '@nestjs/common';

import { AdminToolingController, PartnerToolingController } from './tooling.controller';

/** `/v1/admin/*` controllers of the tooling register. */
export const TOOLING_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminToolingController];

/** `/v1/partner/*` controllers of the tooling register. */
export const TOOLING_PARTNER_CONTROLLERS: Type<unknown>[] = [PartnerToolingController];
