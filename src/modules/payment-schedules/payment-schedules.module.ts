import { Global, Module } from '@nestjs/common';

import { OrderChargesService } from './order-charges.service';
import { PaymentSchedulesJobs } from './payment-schedules.jobs';
import { PaymentSchedulesService } from './payment-schedules.service';

/** Payment schedules (D-020, ADR-0008): checkout extension, gates, due dates; payments apply to them (B3.2). */
@Global()
@Module({
  providers: [PaymentSchedulesService, PaymentSchedulesJobs, OrderChargesService],
  exports: [PaymentSchedulesService, OrderChargesService],
})
export class PaymentSchedulesModule {}
