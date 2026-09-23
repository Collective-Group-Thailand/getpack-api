import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type Job } from 'bullmq';

import { EventConsumerRunner } from '../event-consumer.runner';
import { OutboxRelay } from '../outbox-relay.service';
import { type DomainEventJob, QUEUES } from './queues';

@Processor(QUEUES.domainEvents, { concurrency: 10 })
export class DomainEventProcessor extends WorkerHost {
  private readonly logger = new Logger(DomainEventProcessor.name);

  constructor(
    private readonly runner: EventConsumerRunner,
    private readonly relay: OutboxRelay,
  ) {
    super();
  }

  async process(job: Job<DomainEventJob>): Promise<string> {
    const outcome = await this.runner.consume(job.data.consumer, job.data.event);
    if (outcome === 'unknown_consumer') {
      this.logger.warn(
        `no consumer ${job.data.consumer} in this worker build; event ${job.data.event.id} skipped`,
      );
    }
    return outcome;
  }

  /** After the last retry the event goes to the dead-letter list (admin replay). */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<DomainEventJob> | undefined, error: Error): Promise<void> {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    await this.relay.markDead(job.data.event.id, job.data.consumer, error);
  }
}
