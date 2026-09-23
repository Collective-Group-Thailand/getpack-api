import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { type OnApplicationBootstrap } from '@nestjs/common';
import { type Queue } from 'bullmq';

import { OutboxRelay } from '../outbox-relay.service';
import { QUEUES } from './queues';

const BATCH = 100;
const BUDGET_MS = 5_000;

/**
 * A job scheduler fires the relay every second on exactly one worker (BullMQ job schedulers are
 * cluster-safe); each run drains due rows for up to 5 seconds.
 */
@Processor(QUEUES.outboxRelay, { concurrency: 1 })
export class OutboxRelayProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    private readonly relay: OutboxRelay,
    @InjectQueue(QUEUES.outboxRelay) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'outbox-relay',
      { every: 1_000 },
      { name: 'relay', opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }

  async process(): Promise<number> {
    const started = Date.now();
    let total = 0;
    for (;;) {
      const claimed = await this.relay.relayBatch(BATCH);
      total += claimed;
      if (claimed < BATCH || Date.now() - started > BUDGET_MS) return total;
    }
  }
}
