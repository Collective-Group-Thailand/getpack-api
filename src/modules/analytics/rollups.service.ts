import { addCalendarDays, bangkokDate } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '@platform/settings/settings.service';

import { bind, DIMENSIONS_SQL, ROLLUP_JOBS, type RollupJob } from './rollups.sql';

/** Longest backfill one request may queue (technical bound). */
export const MAX_BACKFILL_DAYS = 366;
/** A rollup of a busy day may take longer than Prisma's 5 s default transaction timeout. */
const JOB_TIMEOUT_MS = 10 * 60_000;

export interface RollupRunRow {
  job: string;
  for_date: Date;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  row_count: number | null;
  error: string | null;
  attempts: number;
  queued_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addCalendarDays(d, 1)) days.push(d);
  return days;
}

/**
 * Runs the analytics rollups (B6.1): dimensions first, then each fact of a date in its own transaction under an
 * advisory lock (a nightly run and a backfill of the same date never interleave), recorded in
 * `analytics.rollup_runs`. A failing fact is recorded and does not stop the others.
 */
@Injectable()
export class AnalyticsRollupService {
  private readonly logger = new Logger(AnalyticsRollupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Yesterday and the days before it that a late payment can still change: an unpaid order group stays open
   * for `orders.unpaid_expiry_days` (D-060), so its "paid" measures settle only after that window.
   */
  async nightly(now = new Date()): Promise<number> {
    const yesterday = addCalendarDays(bangkokDate(now), -1);
    const window = (await this.settings.at('orders.unpaid_expiry_days', { at: now })).value;
    let rows = 0;
    for (const day of daysBetween(addCalendarDays(yesterday, -window), yesterday))
      rows += await this.runDay(day);
    return rows;
  }

  /** Every fact of one date; returns the fact rows written. */
  async runDay(day: string): Promise<number> {
    await this.prisma.withTx(
      async (tx) => {
        for (const sql of DIMENSIONS_SQL) await tx.$executeRawUnsafe(bind(sql, day));
      },
      { timeout: JOB_TIMEOUT_MS },
    );
    let rows = 0;
    for (const job of ROLLUP_JOBS) rows += (await this.runJob(job, day)) ?? 0;
    return rows;
  }

  private async runJob(job: RollupJob, day: string): Promise<number | null> {
    await this.prisma.$executeRaw`
      INSERT INTO analytics.rollup_runs (job, for_date, status, attempts, started_at, finished_at, error)
      VALUES (${job.key}, ${day}::date, 'running', 1, now(), NULL, NULL)
      ON CONFLICT (job, for_date) DO UPDATE
        SET status = 'running', attempts = analytics.rollup_runs.attempts + 1, started_at = now(), finished_at = NULL, error = NULL`;
    try {
      const count = await this.prisma.withTx(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`analytics:${job.key}:${day}`}))`;
          let last = 0;
          for (const sql of job.statements) last = await tx.$executeRawUnsafe(bind(sql, day));
          return last;
        },
        { timeout: JOB_TIMEOUT_MS },
      );
      await this.prisma.$executeRaw`
        UPDATE analytics.rollup_runs SET status = 'succeeded', row_count = ${count}, finished_at = now()
        WHERE job = ${job.key} AND for_date = ${day}::date`;
      return count;
    } catch (error) {
      const message = (error as Error).message.slice(0, 500);
      this.logger.error(`analytics rollup ${job.key} ${day} failed: ${message}`);
      await this.prisma.$executeRaw`
        UPDATE analytics.rollup_runs SET status = 'failed', error = ${message}, finished_at = now()
        WHERE job = ${job.key} AND for_date = ${day}::date`;
      return null;
    }
  }

  /** Admin backfill: every job of every date is queued (a running one is left alone). */
  async queue(from: string, to: string, requestedBy: bigint): Promise<number> {
    const days = daysBetween(from, to);
    let queued = 0;
    for (const day of days) {
      for (const job of ROLLUP_JOBS) {
        queued += await this.prisma.$executeRaw`
          INSERT INTO analytics.rollup_runs (job, for_date, status, requested_by)
          VALUES (${job.key}, ${day}::date, 'queued', ${requestedBy})
          ON CONFLICT (job, for_date) DO UPDATE
            SET status = 'queued', requested_by = EXCLUDED.requested_by, queued_at = now(), error = NULL
            WHERE analytics.rollup_runs.status <> 'running'`;
      }
    }
    return queued;
  }

  /** Worker: the oldest queued dates, a few at a time. */
  async processQueue(maxDays = 7): Promise<number> {
    const due = await this.prisma.$queryRaw<{ for_date: Date }[]>`
      SELECT DISTINCT for_date FROM analytics.rollup_runs WHERE status = 'queued' ORDER BY for_date LIMIT ${maxDays}`;
    let rows = 0;
    for (const { for_date } of due) rows += await this.runDay(for_date.toISOString().slice(0, 10));
    return rows;
  }

  runs(from: string, to: string): Promise<RollupRunRow[]> {
    return this.prisma.$queryRaw<RollupRunRow[]>`
      SELECT job, for_date, status, row_count, error, attempts, queued_at, started_at, finished_at
      FROM analytics.rollup_runs WHERE for_date BETWEEN ${from}::date AND ${to}::date
      ORDER BY for_date DESC, job`;
  }
}
