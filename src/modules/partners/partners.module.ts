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
import { SuggestionEngine } from './pricing/suggestion-engine';
import { QuotePathService } from './quote-path/quote-path.service';
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
  QuotePathService,
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
    // QUOTE_REPRICER comes from the global QuotesModule (saved quotes, B2.5).
  ],
  exports: SERVICES,
})
export class PartnersModule {}
