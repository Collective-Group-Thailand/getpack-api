import { Global, Module } from '@nestjs/common';

import { CalculatorRegistry } from './calculators/calculator';
import { CorrugateQuoteAdapter } from './calculators/corrugate/corrugate.adapter';
import { CorrugateSnapshotLoader } from './calculators/corrugate/corrugate-snapshot.loader';
import { CorrugatePriceComponentsRegistrar } from './calculators/corrugate/price-components.registrar';
import { FoldingQuoteAdapter } from './calculators/folding/folding.adapter';
import { FoldingSnapshotLoader } from './calculators/folding/folding-snapshot.loader';
import { FoldingPriceComponentsRegistrar } from './calculators/folding/price-components.registrar';
import { LabelPriceComponentsRegistrar } from './calculators/label/price-components.registrar';
import { PriceHintsService } from './hints/price-hints.service';
import { CorrugateInputDataService } from './quotes/corrugate-input-data.service';
import { FoldingInputDataService } from './quotes/folding-input-data.service';
import { QuoteEngineService } from './quotes/quote-engine.service';
import { SellMarginsService } from './sell-margins/sell-margins.service';

const SERVICES = [
  CalculatorRegistry,
  FoldingSnapshotLoader,
  FoldingQuoteAdapter,
  CorrugateSnapshotLoader,
  CorrugateQuoteAdapter,
  QuoteEngineService,
  FoldingInputDataService,
  CorrugateInputDataService,
  SellMarginsService,
  PriceHintsService,
];

/**
 * Pricing calculators, sell margins, quotes & RFQ (schema-design §3.5, B2.3–B2.5). Loaded by both
 * processes: the HTTP app prices on request; the worker re-prices quotes for impact simulations.
 */
@Global()
@Module({
  providers: [
    ...SERVICES,
    FoldingPriceComponentsRegistrar,
    CorrugatePriceComponentsRegistrar,
    LabelPriceComponentsRegistrar,
  ],
  exports: SERVICES,
})
export class PricingModule {}
