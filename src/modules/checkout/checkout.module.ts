import { Global, Module } from '@nestjs/common';

import { CheckoutExtensions } from './checkout.extensions';
import { CheckoutService } from './checkout.service';

/** Checkout (B3.1); later deliverables register `CheckoutExtensions` (promotions, points, schedules…). */
@Global()
@Module({
  providers: [CheckoutService, CheckoutExtensions],
  exports: [CheckoutService, CheckoutExtensions],
})
export class CheckoutModule {}
