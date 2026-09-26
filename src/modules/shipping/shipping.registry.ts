import { type Type } from '@nestjs/common';

import { CustomerShippingRatesController } from './rates/customer-rates.controller';
import {
  AdminFactoryShippingRatesController,
  PartnerShippingRatesController,
} from './rates/factory-rates.controller';

/** `/v1/admin/*` controllers of the shipping context. */
export const SHIPPING_ADMIN_CONTROLLERS: Type<unknown>[] = [
  CustomerShippingRatesController,
  AdminFactoryShippingRatesController,
];

/** `/v1/partner/*` controllers of the shipping context (own factory only, D-044). */
export const SHIPPING_PARTNER_CONTROLLERS: Type<unknown>[] = [PartnerShippingRatesController];
