import { type Tx } from '@database/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { QUEUES } from '@platform/domain-events/worker/queues';
import { ScheduledJob, scheduledJobOpts } from '@platform/maintenance/scheduled-job.decorator';
import { type Queue } from 'bullmq';

import {
  FIT_RANGE_SYNC_EVENTS,
  FIT_RANGE_SYNC_JOB,
  type FitRangeSyncOutcome,
  FitRangeSyncService,
} from './fit-range-sync';

/** Failed runs retry with exponential backoff from 30 s (30 s, 1, 2, 4 min), then wait for the next check. */
export const FIT_RANGE_SYNC_RETRY = { attempts: 5, backoffMs: 30_000 };
/** The check after a worker start (once the job schedulers are registered) and the debounce of change events. */
export const FIT_RANGE_SYNC_START_DELAY_MS = 15_000;
export const FIT_RANGE_SYNC_DEBOUNCE_MS = 60_000;
const HOURLY = 60 * 60_000;

/**
 * C13 (D-461) worker side of the automatic fit-range backfill: one job `styles.fit_ranges_sync` that runs shortly after
 * every worker start, once an hour (a cheap check: the bundle hash, one audit lookup, the pending set), and — debounced
 * — after the domain events that change what a style's range is made of ({@link FIT_RANGE_SYNC_EVENTS}).
 */
@Injectable()
export class FitRangeSyncJobs implements OnApplicationBootstrap {
  private readonly logger = new Logger(FitRangeSyncJobs.name);

  constructor(
    private readonly sync: FitRangeSyncService,
    @InjectQueue(QUEUES.maintenance) private readonly queue: Queue,
  ) {}

  @ScheduledJob({ name: FIT_RANGE_SYNC_JOB, every: HOURLY, retry: FIT_RANGE_SYNC_RETRY })
  run(): Promise<FitRangeSyncOutcome> {
    return this.sync.run();
  }

  /** On worker start: one run (deduplicated across replicas starting together). Never fails the start. */
  async onApplicationBootstrap(): Promise<void> {
    await this.enqueue('start', FIT_RANGE_SYNC_START_DELAY_MS, false).catch((error: unknown) => {
      this.logger.warn(`fit-range sync not queued at start: ${(error as Error).message}`);
    });
  }

  /** C13 1b: the styles an import or a curation change touches wait for one debounced, limited run. */
  @OnDomainEvent(FIT_RANGE_SYNC_EVENTS, { consumer: 'styles.fit-ranges-sync' })
  async onChange(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const codes = await this.sync.codesAffectedBy(event, tx);
    if ((await this.sync.markPending(codes)) === 0) return;
    await this.enqueue('changed', FIT_RANGE_SYNC_DEBOUNCE_MS, true);
  }

  /** A run of the scheduled job outside its schedule; `debounce` pushes a waiting run back on every new change. */
  private async enqueue(id: 'start' | 'changed', delay: number, debounce: boolean): Promise<void> {
    await this.queue.add(
      FIT_RANGE_SYNC_JOB,
      {},
      {
        ...scheduledJobOpts({ retry: FIT_RANGE_SYNC_RETRY }),
        delay,
        deduplication: {
          id: `${FIT_RANGE_SYNC_JOB}.${id}`,
          ttl: delay,
          ...(debounce && { extend: true, replace: true }),
        },
      },
    );
  }
}
