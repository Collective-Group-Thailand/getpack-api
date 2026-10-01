import { catalogCrudController } from '@modules/catalog/crud/catalog-crud.controller';
import { type Type } from '@nestjs/common';

import {
  bankAccountsController,
  VendorBankAccountVerificationController,
} from './bank-accounts/bank-accounts.controller';
import { AdminFactoriesController, PartnerFactoriesController } from './factories/factories.controller';
import { factorySubresourcesController } from './factories/factory-subresources.controller';
import { IndexSeriesController } from './index-series/index-series.controller';
import {
  AdminFactoryOperationsController,
  AgreementTemplatesController,
  PartnerFactoryOperationsController,
} from './operations.controller';
import {
  AdminPriceListsController,
  AdminPriceProposalsController,
  AdminPriceSuggestionsController,
  PartnerPriceListsController,
  PartnerPriceProposalsController,
} from './pricing/pricing.controller';
import { AdminCoverageController } from './quote-path/quote-path.controller';
import {
  AdminFactoryChangeRequestsController,
  PartnerChangeRequestsController,
  PartnerFactorySelfServiceController,
} from './self-service/self-service.controller';
import { ZonePostcodesController, zones, zoneSchemes } from './zones/zones';

/** `/v1/admin/*` controllers of the partners context. */
export const PARTNERS_ADMIN_CONTROLLERS: Type<unknown>[] = [
  AdminFactoriesController,
  AdminFactoryOperationsController,
  AgreementTemplatesController,
  ZonePostcodesController,
  catalogCrudController(zoneSchemes),
  catalogCrudController(zones),
  factorySubresourcesController('admin', { read: 'partners.read', manage: 'partners.manage' }),
  bankAccountsController('admin', { read: 'partners.read', propose: 'partners.manage' }),
  VendorBankAccountVerificationController,
  AdminPriceListsController,
  AdminPriceProposalsController,
  AdminPriceSuggestionsController,
  IndexSeriesController,
  AdminCoverageController,
  AdminFactoryChangeRequestsController,
];

/** `/v1/partner/*` controllers of the partners context (own factory only, D-044). */
export const PARTNERS_PARTNER_CONTROLLERS: Type<unknown>[] = [
  PartnerFactoriesController,
  PartnerFactoryOperationsController,
  factorySubresourcesController('partner', {
    read: 'factory_profile.read',
    manage: 'factory_profile.manage',
  }),
  bankAccountsController('partner', {
    read: 'factory_profile.read',
    propose: 'factory_bank_account.propose',
  }),
  PartnerPriceListsController,
  PartnerPriceProposalsController,
  PartnerFactorySelfServiceController,
  PartnerChangeRequestsController,
];
