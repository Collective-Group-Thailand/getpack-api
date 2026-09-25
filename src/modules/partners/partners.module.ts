import { FieldEncryption } from '@common/crypto/field-encryption';
import { LookupHasher } from '@common/crypto/lookup-hasher';
import { Global, Module } from '@nestjs/common';

import { AgreementsService } from './agreements/agreements.service';
import { BankAccountsService } from './bank-accounts/bank-accounts.service';
import { CapabilityService } from './capability/capability.service';
import { CapacityService } from './capacity/capacity.service';
import { ConfigurationService } from './configuration/configuration.service';
import { FactoriesService } from './factories/factories.service';
import { FactoryAccess } from './factories/factory-access';
import { FactoryScopeResolver } from './factory-scope.resolver';
import { PriceComponentRegistry } from './pricing/price-component.registry';
import { PriceListBuilder } from './pricing/price-list-builder';
import { PriceListsService } from './pricing/price-lists.service';
import { PriceProposalRecorder } from './pricing/price-proposal-recorder';
import { PriceProposalsService } from './pricing/price-proposals.service';
import { SiteVisitsService } from './site-visits/site-visits.service';

const SERVICES = [
  FactoryAccess,
  FactoriesService,
  BankAccountsService,
  ConfigurationService,
  CapabilityService,
  CapacityService,
  AgreementsService,
  SiteVisitsService,
  PriceComponentRegistry,
  PriceListBuilder,
  PriceProposalRecorder,
  PriceListsService,
  PriceProposalsService,
  FieldEncryption,
  LookupHasher,
];

/**
 * Partners & price governance (schema-design §3.4, B2.2). Loaded by both processes: the HTTP app
 * serves the admin and partner surfaces; the worker runs the approval-outcome subscribers.
 */
@Global()
@Module({
  providers: [...SERVICES, FactoryScopeResolver],
  exports: SERVICES,
})
export class PartnersModule {}
