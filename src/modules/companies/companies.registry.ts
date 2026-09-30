import { type Type } from '@nestjs/common';

import { StoreCompanyAssetsController } from './brand-assets.controller';
import {
  AdminCompaniesController,
  StoreCompaniesController,
  StoreCompanyApprovalsController,
} from './companies.controller';
import { AdminCompanyCreditController, StoreCompanyCreditController } from './credit.controller';

export const COMPANIES_STORE_CONTROLLERS: Type<unknown>[] = [
  StoreCompaniesController,
  StoreCompanyApprovalsController,
  StoreCompanyCreditController,
  StoreCompanyAssetsController,
];
export const COMPANIES_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminCompaniesController,
  AdminCompanyCreditController,
];
