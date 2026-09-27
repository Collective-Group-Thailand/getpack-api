import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { PaymentsService } from './payments.service';
import { RefundsService } from './refunds.service';

/** Payment housekeeping in the worker. */
@Injectable()
export class PaymentsJobs {
  constructor(
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
  ) {}

  /** QR and 2C2P attempts past their lifetime expire; the order keeps its own expiry (D-060). */
  @ScheduledJob({ name: 'payments.expire', every: 60_000 })
  expire(): Promise<number> {
    return this.payments.expireDue();
  }

  /** Approved gateway refunds are sent to the provider (outside the approval transaction). */
  @ScheduledJob({ name: 'refunds.execute', every: 60_000 })
  executeRefunds(): Promise<number> {
    return this.refunds.executeApproved();
  }
}
