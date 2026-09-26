import { Global, Module } from '@nestjs/common';

import { CalculatorRegistry } from './calculators/calculator';
import { FoldingSnapshotLoader } from './calculators/folding/folding-snapshot.loader';
import { FoldingPriceComponentsRegistrar } from './calculators/folding/price-components.registrar';
import { FoldingInputDataService } from './quotes/folding-input-data.service';
import { QuoteEngineService } from './quotes/quote-engine.service';
import { SellMarginsService } from './sell-margins/sell-margins.service';

const SERVICES = [
  CalculatorRegistry,
  FoldingSnapshotLoader,
  QuoteEngineService,
  FoldingInputDataService,
  SellMarginsService,
];

/**
 * Pricing calculators, sell margins, quotes & RFQ (schema-design §3.5, B2.3–B2.5). Loaded by both
 * processes: the HTTP app prices on request; the worker re-prices quotes for impact simulations.
 */
@Global()
@Module({
  providers: [...SERVICES, FoldingPriceComponentsRegistrar],
  exports: SERVICES,
})
export class PricingModule {}
