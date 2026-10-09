import { PriceComponentRegistry } from '@modules/partners/pricing/price-component.registry';
import { Injectable, type OnModuleInit } from '@nestjs/common';

import { CALCULATOR_READS } from '../component-reads';
import { FOLDING_PRICE_COMPONENTS } from './price-components';

/** Registers the folding price components with price governance (proposals, versions, suggestions). */
@Injectable()
export class FoldingPriceComponentsRegistrar implements OnModuleInit {
  constructor(private readonly registry: PriceComponentRegistry) {}

  onModuleInit(): void {
    for (const descriptor of FOLDING_PRICE_COMPONENTS) this.registry.register(descriptor);
    this.registry.declareReads('folding', CALCULATOR_READS.folding);
    this.registry.declareReads('tag_sleeve', CALCULATOR_READS.tag_sleeve);
  }
}
