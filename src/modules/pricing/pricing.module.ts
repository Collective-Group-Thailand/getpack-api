import { Global, Module } from '@nestjs/common';

import { CalculatorRegistry } from './calculators/calculator';

const SERVICES = [CalculatorRegistry];

/**
 * Pricing calculators, sell margins, quotes & RFQ (schema-design §3.5, B2.3–B2.5). Loaded by both
 * processes: the HTTP app prices on request; the worker re-prices quotes for impact simulations.
 */
@Global()
@Module({
  providers: SERVICES,
  exports: SERVICES,
})
export class PricingModule {}
