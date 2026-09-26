import { Global, Module } from '@nestjs/common';

import { CustomerRatesService } from './rates/customer-rates.service';
import { FactoryRatesService } from './rates/factory-rates.service';
import { RateWorkbookService } from './rates/rate-workbook.service';
import { ShippingRatesResolver } from './rates/shipping-rates.resolver';
import { ZoneRefs } from './rates/zone-refs';

const SERVICES = [
  ZoneRefs,
  RateWorkbookService,
  CustomerRatesService,
  ShippingRatesResolver,
  FactoryRatesService,
];

/**
 * Shipping rate cards, packing and fallback carriers (schema-design §3.5, B2.4, D-013, D-114). Loaded
 * by both processes: the HTTP app prices delivery on quotes; the worker runs the approval subscribers.
 */
@Global()
@Module({
  providers: SERVICES,
  exports: SERVICES,
})
export class ShippingModule {}
