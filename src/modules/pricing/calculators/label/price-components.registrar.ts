import { PriceComponentRegistry } from '@modules/partners/pricing/price-component.registry';
import { Injectable, type OnModuleInit } from '@nestjs/common';

import { LABEL_PRICE_COMPONENTS } from './price-components';

/** Registers the label price components with price governance (proposals, versions, suggestions). */
@Injectable()
export class LabelPriceComponentsRegistrar implements OnModuleInit {
  constructor(private readonly registry: PriceComponentRegistry) {}

  onModuleInit(): void {
    for (const descriptor of LABEL_PRICE_COMPONENTS) this.registry.register(descriptor);
  }
}
