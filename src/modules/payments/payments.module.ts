import { Global, Module } from '@nestjs/common';

import { PaymentMethodsCheckout } from './payment-methods-checkout.extension';
import { PaymentsJobs } from './payments.jobs';
import { PaymentsService } from './payments.service';
import { RefundsService } from './refunds.service';

/** Payments, slips and provider callbacks (D-061, B3.2). */
@Global()
@Module({
  providers: [PaymentsService, RefundsService, PaymentsJobs, PaymentMethodsCheckout],
  exports: [PaymentsService, RefundsService],
})
export class PaymentsModule {}
