import { type Type } from '@nestjs/common';

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
];
export const COMPANIES_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminCompaniesController,
  AdminCompanyCreditController,
];
