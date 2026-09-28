import { type Type } from '@nestjs/common';

import { AdminCustomerDocumentsController, AdminReceivablesController, StoreDocumentsController } from './receivables.controller';

export const RECEIVABLES_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminCustomerDocumentsController, AdminReceivablesController];
export const RECEIVABLES_STORE_CONTROLLERS: Type<unknown>[] = [StoreDocumentsController];
