import { type Type } from '@nestjs/common';

import {
  AdminRfqsController,
  PartnerRfqConsultationsController,
  StoreRfqFormsController,
  StoreRfqsController,
} from '../rfq/rfqs.controller';
import { AdminQuotesController, StoreSavedQuotesController } from './quotes.controller';

/** `/v1/store/*` controllers of the quotes & RFQ context. */
export const QUOTES_STORE_CONTROLLERS: Type<unknown>[] = [
  StoreSavedQuotesController,
  StoreRfqFormsController,
  StoreRfqsController,
];

/** `/v1/admin/*` controllers of the quotes & RFQ context. */
export const QUOTES_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminQuotesController, AdminRfqsController];

/** `/v1/partner/*` controllers of the quotes & RFQ context. */
export const QUOTES_PARTNER_CONTROLLERS: Type<unknown>[] = [PartnerRfqConsultationsController];
