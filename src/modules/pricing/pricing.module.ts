import { Global, Module } from '@nestjs/common';

import { CalculatorRegistry } from './calculators/calculator';
import { CorrugateQuoteAdapter } from './calculators/corrugate/corrugate.adapter';
import { CorrugateSnapshotLoader } from './calculators/corrugate/corrugate-snapshot.loader';
import { CorrugatePriceComponentsRegistrar } from './calculators/corrugate/price-components.registrar';
import { FoldingQuoteAdapter } from './calculators/folding/folding.adapter';
import { FoldingSnapshotLoader } from './calculators/folding/folding-snapshot.loader';
import { FoldingPriceComponentsRegistrar } from './calculators/folding/price-components.registrar';
import { LabelQuoteAdapter } from './calculators/label/label.adapter';
import { LabelSnapshotLoader } from './calculators/label/label-snapshot.loader';
import { LabelPriceComponentsRegistrar } from './calculators/label/price-components.registrar';
import { PouchQuoteAdapter } from './calculators/pouch/pouch.adapter';
import { PouchSnapshotLoader } from './calculators/pouch/pouch-snapshot.loader';
import { PouchPriceComponentsRegistrar } from './calculators/pouch/price-components.registrar';
import { TagSleeveQuoteAdapter } from './calculators/tag-sleeve/tag-sleeve.adapter';
import { PriceHintsService } from './hints/price-hints.service';
import { CorrugateInputDataService } from './quotes/corrugate-input-data.service';
import { FoldingInputDataService } from './quotes/folding-input-data.service';
import { LabelInputDataService } from './quotes/label-input-data.service';
import { PouchInputDataService } from './quotes/pouch-input-data.service';
import { QuoteEngineService } from './quotes/quote-engine.service';
import { SellMarginsService } from './sell-margins/sell-margins.service';

const SERVICES = [
  CalculatorRegistry,
  FoldingSnapshotLoader,
  FoldingQuoteAdapter,
  CorrugateSnapshotLoader,
  CorrugateQuoteAdapter,
  LabelSnapshotLoader,
  LabelQuoteAdapter,
  TagSleeveQuoteAdapter,
  PouchSnapshotLoader,
  PouchQuoteAdapter,
  QuoteEngineService,
  FoldingInputDataService,
  CorrugateInputDataService,
  LabelInputDataService,
  PouchInputDataService,
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
    PouchPriceComponentsRegistrar,
  ],
  exports: SERVICES,
})
export class PricingModule {}
