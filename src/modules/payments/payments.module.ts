import { Global, Module } from '@nestjs/common';

import { PaymentsJobs } from './payments.jobs';
import { PaymentsService } from './payments.service';

/** Payments, slips and provider callbacks (D-061, B3.2). */
@Global()
@Module({
  providers: [PaymentsService, PaymentsJobs],
  exports: [PaymentsService],
})
export class PaymentsModule {}
