import { type Type } from '@nestjs/common';

import { AdminCompaniesController, StoreCompaniesController, StoreCompanyApprovalsController } from './companies.controller';

export const COMPANIES_STORE_CONTROLLERS: Type<unknown>[] = [StoreCompaniesController, StoreCompanyApprovalsController];
export const COMPANIES_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminCompaniesController];
