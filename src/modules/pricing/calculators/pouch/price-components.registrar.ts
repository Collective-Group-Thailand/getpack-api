import { PriceComponentRegistry } from '@modules/partners/pricing/price-component.registry';
import { Injectable, type OnModuleInit } from '@nestjs/common';

import { POUCH_PRICE_COMPONENTS } from './price-components';

/** Registers the pouch price components with price governance (proposals, versions, suggestions). */
@Injectable()
export class PouchPriceComponentsRegistrar implements OnModuleInit {
  constructor(private readonly registry: PriceComponentRegistry) {}

  onModuleInit(): void {
    for (const descriptor of POUCH_PRICE_COMPONENTS) this.registry.register(descriptor);
  }
}
