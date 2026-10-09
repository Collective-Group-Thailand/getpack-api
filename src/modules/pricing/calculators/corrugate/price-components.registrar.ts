import { PriceComponentRegistry } from '@modules/partners/pricing/price-component.registry';
import { Injectable, type OnModuleInit } from '@nestjs/common';

import { CALCULATOR_READS } from '../component-reads';
import { CORRUGATE_PRICE_COMPONENTS } from './price-components';

/** Registers the corrugate price components with price governance (proposals, versions, suggestions). */
@Injectable()
export class CorrugatePriceComponentsRegistrar implements OnModuleInit {
  constructor(private readonly registry: PriceComponentRegistry) {}

  onModuleInit(): void {
    for (const descriptor of CORRUGATE_PRICE_COMPONENTS) this.registry.register(descriptor);
    this.registry.declareReads('corrugate', CALCULATOR_READS.corrugate);
  }
}
