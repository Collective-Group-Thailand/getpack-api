import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { HousekeepingJobs } from '../maintenance/housekeeping.jobs';
import { ScheduledJobsProcessor } from '../maintenance/scheduled-jobs.processor';
import { EventConsumerRunner } from './event-consumer.runner';
import { OutboxRelay, SubscriberDispatcher } from './outbox-relay.service';
import { SubscriberRegistry } from './subscriber-registry';
import { BullmqSubscriberDispatcher } from './worker/bullmq-subscriber-dispatcher';
import { DomainEventProcessor } from './worker/domain-event.processor';
import { OutboxRelayProcessor } from './worker/outbox-relay.processor';
import { QUEUES } from './worker/queues';

/** Worker side of the outbox: relay, subscriber queue and scheduled jobs. */
@Module({
  imports: [
    DiscoveryModule,
    BullModule.registerQueue(
      { name: QUEUES.outboxRelay },
      { name: QUEUES.domainEvents },
      { name: QUEUES.maintenance },
    ),
  ],
  providers: [
    SubscriberRegistry,
    EventConsumerRunner,
    OutboxRelay,
    { provide: SubscriberDispatcher, useClass: BullmqSubscriberDispatcher },
    OutboxRelayProcessor,
    DomainEventProcessor,
    ScheduledJobsProcessor,
    HousekeepingJobs,
  ],
  exports: [SubscriberRegistry, OutboxRelay],
})
export class DomainEventsWorkerModule {}
