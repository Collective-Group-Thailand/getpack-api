import { type Type } from '@nestjs/common';

import { CustomerShippingRatesController } from './rates/customer-rates.controller';

/** `/v1/admin/*` controllers of the shipping context. */
export const SHIPPING_ADMIN_CONTROLLERS: Type<unknown>[] = [CustomerShippingRatesController];
