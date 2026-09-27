import { type Type } from '@nestjs/common';

import {
  AdminCustomersController,
  StoreAddressesController,
  StoreCustomerProfileController,
  StoreTaxProfilesController,
} from './customers.controller';

/** `/v1/store/*` controllers of the customers context. */
export const CUSTOMERS_STORE_CONTROLLERS: Type<unknown>[] = [
  StoreCustomerProfileController,
  StoreAddressesController,
  StoreTaxProfilesController,
];

/** `/v1/admin/*` controllers of the customers context. */
export const CUSTOMERS_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminCustomersController];
