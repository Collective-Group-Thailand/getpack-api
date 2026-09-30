import { type Type } from '@nestjs/common';

import {
  AdminCustomersController,
  StoreAddressesController,
  StoreCustomerProfileController,
  StoreTaxProfilesController,
} from './customers.controller';
import { AdminPrivacyController, StorePrivacyController } from './privacy.controller';

/** `/v1/store/*` controllers of the customers context. */
export const CUSTOMERS_STORE_CONTROLLERS: Type<unknown>[] = [
  StoreCustomerProfileController,
  StoreAddressesController,
  StoreTaxProfilesController,
  StorePrivacyController,
];

/** `/v1/admin/*` controllers of the customers context. */
export const CUSTOMERS_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminCustomersController, AdminPrivacyController];
