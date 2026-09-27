import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { DiscountMemosService } from './discount-memos.service';

@Injectable()
export class DiscountMemosJobs {
  constructor(private readonly memos: DiscountMemosService) {}

  /** Approved memos past the quote validity expire unused (D-052). */
  @ScheduledJob({ name: 'discount_memos.expire', every: 3_600_000 })
  expire(): Promise<number> {
    return this.memos.expireUnused();
  }
}
