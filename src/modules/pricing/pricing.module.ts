import { Global, Module } from '@nestjs/common';

import { CalculatorRegistry } from './calculators/calculator';
import { FoldingSnapshotLoader } from './calculators/folding/folding-snapshot.loader';
import { FoldingPriceComponentsRegistrar } from './calculators/folding/price-components.registrar';
import { QuoteEngineService } from './quotes/quote-engine.service';

const SERVICES = [CalculatorRegistry, FoldingSnapshotLoader, QuoteEngineService];

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
