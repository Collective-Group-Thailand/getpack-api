import { PriceComponentRegistry } from '@modules/partners/pricing/price-component.registry';
import { Injectable, type OnModuleInit } from '@nestjs/common';

import { SERVICE_PRICE_COMPONENTS } from './price-components';

/** Registers the service price component with price governance (proposals, versions, suggestions). */
@Injectable()
export class ServicePriceComponentsRegistrar implements OnModuleInit {
  constructor(private readonly registry: PriceComponentRegistry) {}

  onModuleInit(): void {
    for (const descriptor of SERVICE_PRICE_COMPONENTS) this.registry.register(descriptor);
  }
}
