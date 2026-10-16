import { SetMetadata } from '@nestjs/common';

export const SCHEDULED_JOB = 'getpack:scheduled-job';

export interface ScheduledJobOptions {
  /** Unique, stable job name (also the BullMQ job-scheduler id). */
  name: string;
  /** Fixed interval in milliseconds, or… */
  every?: number;
  /** …a cron pattern evaluated in Asia/Bangkok. */
  cron?: string;
}

/**
 * Marks a provider method `() => Promise<unknown>` as a repeatable job of the worker. BullMQ job
 * schedulers run each occurrence on exactly one worker replica (00-master-plan §2).
 */
export function ScheduledJob(options: ScheduledJobOptions): MethodDecorator {
  if (!options.every === !options.cron) throw new Error(`${options.name}: set exactly one of every / cron`);
  return SetMetadata(SCHEDULED_JOB, options);
}
