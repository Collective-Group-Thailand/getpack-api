import { type Type } from '@nestjs/common';

import { AdminStorageController, PartnerStorageController } from './storage.controller';

/** `/v1/partner/*` controllers of storage metering (D-436). */
export const STORAGE_PARTNER_CONTROLLERS: Type<unknown>[] = [PartnerStorageController];

/** `/v1/admin/*` controllers of storage metering (D-436). */
export const STORAGE_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminStorageController];
