import { Global, Module } from '@nestjs/common';

import { OrderChargesService } from './order-charges.service';
import { PaymentRemindersService } from './payment-reminders.service';
import { PaymentSchedulesJobs } from './payment-schedules.jobs';
import { PaymentSchedulesService } from './payment-schedules.service';

/** Payment schedules (D-020, ADR-0008): checkout extension, gates, due dates; payments apply to them (B3.2). */
@Global()
@Module({
  providers: [PaymentSchedulesService, PaymentSchedulesJobs, OrderChargesService, PaymentRemindersService],
  exports: [PaymentSchedulesService, OrderChargesService, PaymentRemindersService],
})
export class PaymentSchedulesModule {}
