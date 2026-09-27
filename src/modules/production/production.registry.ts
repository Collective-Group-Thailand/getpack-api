import { type Type } from '@nestjs/common';

import { PartnerProductionController } from './partner-production.controller';
import { AdminProductionController } from './production.controller';

export const PRODUCTION_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminProductionController];
export const PRODUCTION_PARTNER_CONTROLLERS: Type<unknown>[] = [PartnerProductionController];
