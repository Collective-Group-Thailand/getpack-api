import { PrismaService } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { StylePublishingService } from './style-publishing.service';

@Injectable()
export class StylesJobs {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publishing: StylePublishingService,
  ) {}

  /** D-243: nightly recompute of every variant's publishability and reasons (Asia/Bangkok). */
  @ScheduledJob({ name: 'styles.recompute_publishable', cron: '15 3 * * *' })
  async nightly(): Promise<number> {
    const result = await this.prisma.withTx((tx) => this.publishing.recompute(tx), { timeout: 120_000 });
    return result.publishable;
  }
}
