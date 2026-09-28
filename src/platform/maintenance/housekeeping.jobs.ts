import { PrismaService } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';

import { ScheduledJob } from './scheduled-job.decorator';

/** Housekeeping deferred from B1.2 (docs/PROGRESS.md). */
@Injectable()
export class HousekeepingJobs {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Keeps three months of partitions ahead for the partitioned logs: `audit_logs`, `activity_logs`,
   * `calculate_logs`, `search_logs`, `analytics.raw_events` (schema-design §1.7).
   */
  @ScheduledJob({ name: 'partitions.ensure', cron: '15 3 * * *' })
  async ensurePartitions(): Promise<void> {
    await this.prisma
      .$executeRaw`SELECT ensure_monthly_partitions('audit_logs', date_trunc('month', now())::date, 3)`;
    await this.prisma
      .$executeRaw`SELECT ensure_monthly_partitions('activity_logs', date_trunc('month', now())::date, 3)`;
    await this.prisma
      .$executeRaw`SELECT ensure_monthly_partitions('calculate_logs', date_trunc('month', now())::date, 3)`;
    await this.prisma
      .$executeRaw`SELECT ensure_monthly_partitions('search_logs', date_trunc('month', now())::date, 3)`;
    await this.prisma
      .$executeRaw`SELECT ensure_monthly_partitions('analytics.raw_events', date_trunc('month', now())::date, 3)`;
  }

  /** Idempotency keys expire after 24 h (contract §3). */
  @ScheduledJob({ name: 'idempotency.purge', cron: '5 * * * *' })
  async purgeIdempotencyKeys(): Promise<number> {
    return this.prisma.$executeRaw`DELETE FROM idempotency_keys WHERE expires_at < now()`;
  }

  /** OTP challenges are deleted 24 h after expiry (schema-design §3.2). */
  @ScheduledJob({ name: 'otp.purge', cron: '10 * * * *' })
  async purgeOtpChallenges(): Promise<number> {
    return this.prisma.$executeRaw`DELETE FROM otp_challenges WHERE expires_at < now() - interval '24 hours'`;
  }
}
