import { BANGKOK_TZ } from '@common/time/bangkok';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { type Job, type Queue } from 'bullmq';

import { QUEUES } from '../domain-events/worker/queues';
import { SCHEDULED_JOB, type ScheduledJobOptions } from './scheduled-job.decorator';

/** Discovers `@ScheduledJob` methods, registers their schedulers and runs them. */
@Processor(QUEUES.maintenance, { concurrency: 4 })
export class ScheduledJobsProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly jobs = new Map<string, { options: ScheduledJobOptions; run: () => Promise<unknown> }>();

  constructor(
    @InjectQueue(QUEUES.maintenance) private readonly queue: Queue,
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      if (!instance || typeof instance !== 'object' || !wrapper.isDependencyTreeStatic()) continue;
      for (const name of this.scanner.getAllMethodNames(Object.getPrototypeOf(instance) as object)) {
        const method = instance[name];
        if (typeof method !== 'function') continue;
        const options = this.reflector.get<ScheduledJobOptions | undefined>(SCHEDULED_JOB, method);
        if (!options) continue;
        if (this.jobs.has(options.name)) throw new Error(`Duplicate scheduled job ${options.name}`);
        this.jobs.set(options.name, { options, run: (method as () => Promise<unknown>).bind(instance) });
      }
    }
    for (const { options } of this.jobs.values()) {
      await this.queue.upsertJobScheduler(
        options.name,
        options.every ? { every: options.every } : { pattern: options.cron!, tz: BANGKOK_TZ },
        { name: options.name, opts: { removeOnComplete: 100, removeOnFail: 500 } },
      );
    }
  }

  async process(job: Job): Promise<unknown> {
    const entry = this.jobs.get(job.name);
    if (!entry) return 'unknown_job';
    return entry.run();
  }
}
