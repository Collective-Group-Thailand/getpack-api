import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { PaymentsService } from './payments.service';

/** Payment housekeeping in the worker. */
@Injectable()
export class PaymentsJobs {
  constructor(private readonly payments: PaymentsService) {}

  /** QR and 2C2P attempts past their lifetime expire; the order keeps its own expiry (D-060). */
  @ScheduledJob({ name: 'payments.expire', every: 60_000 })
  expire(): Promise<number> {
    return this.payments.expireDue();
  }
}
