import { type Type } from '@nestjs/common';

import { AdminCompaniesController, StoreCompaniesController } from './companies.controller';

export const COMPANIES_STORE_CONTROLLERS: Type<unknown>[] = [StoreCompaniesController];
export const COMPANIES_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminCompaniesController];
