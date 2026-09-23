import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { type Queue } from 'bullmq';

import { type DomainEventEnvelope } from '../domain-event';
import { SubscriberDispatcher } from '../outbox-relay.service';
import { type DomainEventJob, QUEUES, SUBSCRIBER_ATTEMPTS } from './queues';

/** One BullMQ job per (consumer, event, dispatch), retried with exponential backoff. */
@Injectable()
export class BullmqSubscriberDispatcher extends SubscriberDispatcher {
  constructor(@InjectQueue(QUEUES.domainEvents) private readonly queue: Queue<DomainEventJob>) {
    super();
  }

  async dispatch(
    jobs: { consumer: string; event: DomainEventEnvelope }[],
    dispatchNo: number,
  ): Promise<void> {
    await this.queue.addBulk(
      jobs.map(({ consumer, event }) => ({
        name: event.type,
        data: { consumer, event },
        opts: {
          // BullMQ forbids ':' in custom ids.
          jobId: `${consumer}__${event.id}__${dispatchNo}`,
          attempts: SUBSCRIBER_ATTEMPTS,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: { age: 86_400, count: 10_000 },
          removeOnFail: { age: 7 * 86_400 },
        },
      })),
    );
  }
}
