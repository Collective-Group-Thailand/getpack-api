import { type Type } from '@nestjs/common';

import {
  AdminSamplesController,
  PartnerSamplesController,
  StoreSamplesController,
} from './samples.controller';

/** `/v1/store/*` controllers of samples. */
export const SAMPLES_STORE_CONTROLLERS: Type<unknown>[] = [StoreSamplesController];

/** `/v1/admin/*` controllers of samples. */
export const SAMPLES_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminSamplesController];

/** `/v1/partner/*` controllers of samples. */
export const SAMPLES_PARTNER_CONTROLLERS: Type<unknown>[] = [PartnerSamplesController];
