import { type Type } from '@nestjs/common';

import { AdminClaimsController, PartnerClaimsController, StoreClaimsController } from './claims.controller';

export const CLAIMS_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminClaimsController];
export const CLAIMS_PARTNER_CONTROLLERS: Type<unknown>[] = [PartnerClaimsController];
export const CLAIMS_STORE_CONTROLLERS: Type<unknown>[] = [StoreClaimsController];
