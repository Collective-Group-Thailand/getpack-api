import { type Type } from '@nestjs/common';

import {
  B2bDocumentsController,
  B2bMeController,
  B2bOrdersController,
  B2bWebhooksController,
  StoreCompanyApiClientsController,
} from './b2b.controller';

/** `/v1/store/*` controllers of the B2B API (the Company Admin issues clients). */
export const B2B_STORE_CONTROLLERS: Type<unknown>[] = [StoreCompanyApiClientsController];

/** `/v1/b2b/*` controllers: what a company API client calls. */
export const B2B_API_CONTROLLERS: Type<unknown>[] = [
  B2bMeController,
  B2bOrdersController,
  B2bDocumentsController,
  B2bWebhooksController,
];
