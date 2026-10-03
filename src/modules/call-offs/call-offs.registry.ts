import { type Type } from '@nestjs/common';

import {
  AdminCallOffsController,
  PartnerCallOffsController,
  StoreCallOffsController,
} from './call-offs.controller';

/** `/v1/store/*` controllers of call-offs. */
export const CALL_OFFS_STORE_CONTROLLERS: Type<unknown>[] = [StoreCallOffsController];

/** `/v1/partner/*` controllers of call-offs. */
export const CALL_OFFS_PARTNER_CONTROLLERS: Type<unknown>[] = [PartnerCallOffsController];

/** `/v1/admin/*` controllers of call-offs. */
export const CALL_OFFS_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminCallOffsController];
