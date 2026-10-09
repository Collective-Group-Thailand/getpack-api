import { PriceComponentRegistry } from '@modules/partners/pricing/price-component.registry';
import { Injectable, type OnModuleInit } from '@nestjs/common';

import { CALCULATOR_READS } from '../component-reads';
import { STANDARD_PRODUCT_PRICE_COMPONENTS } from './price-components';

/** Registers the standard-product price component with price governance (proposals, versions, suggestions). */
@Injectable()
export class StandardProductPriceComponentsRegistrar implements OnModuleInit {
  constructor(private readonly registry: PriceComponentRegistry) {}

  onModuleInit(): void {
    for (const descriptor of STANDARD_PRODUCT_PRICE_COMPONENTS) this.registry.register(descriptor);
    this.registry.declareReads('standard_product', CALCULATOR_READS.standard_product);
  }
}
