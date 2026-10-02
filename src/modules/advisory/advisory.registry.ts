import { type Type } from '@nestjs/common';

import { AdminAdvisoryController, StoreAdvisoryController } from './advisory.controller';
import {
  AdminBoardStrengthSheetsController,
  PartnerBoardStrengthSheetsController,
} from './board-sheets.controller';

/** `/v1/store/*` controllers of the Structure Advisor. */
export const ADVISORY_STORE_CONTROLLERS: Type<unknown>[] = [StoreAdvisoryController];

/** `/v1/admin/*` controllers of the Structure Advisor. */
export const ADVISORY_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminAdvisoryController,
  AdminBoardStrengthSheetsController,
];

/** `/v1/partner/*` controllers of the Structure Advisor. */
export const ADVISORY_PARTNER_CONTROLLERS: Type<unknown>[] = [PartnerBoardStrengthSheetsController];
