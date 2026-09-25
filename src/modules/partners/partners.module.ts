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
import { IndexSeriesService } from './index-series/index-series.service';
import { PriceComponentRegistry } from './pricing/price-component.registry';
import { PriceListBuilder } from './pricing/price-list-builder';
import { PriceListsService } from './pricing/price-lists.service';
import { PriceProposalRecorder } from './pricing/price-proposal-recorder';
import { PriceProposalsService } from './pricing/price-proposals.service';
import { PriceSimulationsService } from './pricing/price-simulations.service';
import { PriceSuggestionsService } from './pricing/price-suggestions.service';
import { NoQuotesRepricer, QUOTE_REPRICER } from './pricing/quote-repricer.port';
import { SuggestionEngine } from './pricing/suggestion-engine';
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
  IndexSeriesService,
  SuggestionEngine,
  PriceSuggestionsService,
  PriceSimulationsService,
  FieldEncryption,
  LookupHasher,
];

/**
 * Partners & price governance (schema-design §3.4, B2.2). Loaded by both processes: the HTTP app
 * serves the admin and partner surfaces; the worker runs the approval-outcome subscribers.
 */
@Global()
@Module({
  providers: [
    ...SERVICES,
    FactoryScopeResolver,
    // Replaced by quoting (B2.5) once quotes can be re-priced.
    { provide: QUOTE_REPRICER, useClass: NoQuotesRepricer },
  ],
  exports: SERVICES,
})
export class PartnersModule {}
