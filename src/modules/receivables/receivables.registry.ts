import { type Type } from '@nestjs/common';

import {
  AdminCustomerDocumentsController,
  AdminDocumentCorrectionsController,
  AdminReceivablesController,
  StoreDocumentsController,
} from './receivables.controller';

export const RECEIVABLES_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminCustomerDocumentsController,
  AdminReceivablesController,
  AdminDocumentCorrectionsController,
];
export const RECEIVABLES_STORE_CONTROLLERS: Type<unknown>[] = [StoreDocumentsController];
