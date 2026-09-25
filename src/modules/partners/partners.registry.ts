import { type Type } from '@nestjs/common';

import {
  bankAccountsController,
  VendorBankAccountVerificationController,
} from './bank-accounts/bank-accounts.controller';
import { AdminFactoriesController, PartnerFactoriesController } from './factories/factories.controller';
import { factorySubresourcesController } from './factories/factory-subresources.controller';

/** `/v1/admin/*` controllers of the partners context. */
export const PARTNERS_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminFactoriesController,
  factorySubresourcesController('admin', { read: 'partners.read', manage: 'partners.manage' }),
  bankAccountsController('admin', { read: 'partners.read', propose: 'partners.manage' }),
  VendorBankAccountVerificationController,
];

/** `/v1/partner/*` controllers of the partners context (own factory only, D-044). */
export const PARTNERS_PARTNER_CONTROLLERS: Type<unknown>[] = [
  PartnerFactoriesController,
  factorySubresourcesController('partner', {
    read: 'factory_profile.read',
    manage: 'factory_profile.manage',
  }),
  bankAccountsController('partner', {
    read: 'factory_profile.read',
    propose: 'factory_bank_account.propose',
  }),
];
