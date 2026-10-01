import { type Type } from '@nestjs/common';

import { AdminCloseController, AdminSubledgerReconciliationController } from './close.controller';

export const CLOSE_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminCloseController,
  AdminSubledgerReconciliationController,
];
