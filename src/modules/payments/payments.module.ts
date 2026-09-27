import { Global, Module } from '@nestjs/common';

import { PaymentsJobs } from './payments.jobs';
import { PaymentsService } from './payments.service';
import { RefundsService } from './refunds.service';

/** Payments, slips and provider callbacks (D-061, B3.2). */
@Global()
@Module({
  providers: [PaymentsService, RefundsService, PaymentsJobs],
  exports: [PaymentsService, RefundsService],
})
export class PaymentsModule {}
