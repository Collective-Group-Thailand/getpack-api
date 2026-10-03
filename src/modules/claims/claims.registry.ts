import { type Type } from '@nestjs/common';

import {
  AdminClaimsController,
  PartnerClaimsController,
  StoreBulkReorderController,
  StoreClaimsController,
} from './claims.controller';
import { AdminGuaranteeController, StoreGuaranteeController } from './guarantee.controller';

export const CLAIMS_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminClaimsController, AdminGuaranteeController];
export const CLAIMS_PARTNER_CONTROLLERS: Type<unknown>[] = [PartnerClaimsController];
export const CLAIMS_STORE_CONTROLLERS: Type<unknown>[] = [
  StoreClaimsController,
  StoreBulkReorderController,
  StoreGuaranteeController,
];
