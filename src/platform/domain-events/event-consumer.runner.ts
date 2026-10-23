import { systemActor } from '@common/context/actor';
import { RequestContext } from '@common/context/request-context';
import { ErpPrismaService } from '@database/erp-prisma.service';
import { type AnyTx, PrismaService } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';

import { type DomainEventEnvelope } from './domain-event';
import { SubscriberRegistry } from './subscriber-registry';

export type ConsumeOutcome = 'processed' | 'duplicate' | 'unknown_consumer';

/**
 * Runs one subscriber for one event exactly once: the consumption row and the handler's writes
 * commit together, and a second delivery finds the row and does nothing (schema-design §2.6).
 */
@Injectable()
export class EventConsumerRunner {
  constructor(
    private readonly prisma: PrismaService,
    private readonly erpPrisma: ErpPrismaService,
    private readonly registry: SubscriberRegistry,
  ) {}

  async consume(consumer: string, event: DomainEventEnvelope): Promise<ConsumeOutcome> {
    const subscriber = this.registry.get(consumer);
    if (!subscriber) return 'unknown_consumer';

    // The handler runs in a transaction of its own client (ADR-0013); the consumption row is plain SQL on either.
    const withTx = <T>(work: (tx: AnyTx) => Promise<T>): Promise<T> =>
      subscriber.client === 'erp' ? this.erpPrisma.withTx(work) : this.prisma.withTx(work);
    return RequestContext.run(
      { correlationId: event.correlationId, causationId: event.id, actor: systemActor(consumer) },
      () =>
        withTx(async (tx) => {
          const inserted = await tx.$executeRaw`
            INSERT INTO event_consumptions (consumer, event_id, outcome)
            VALUES (${consumer}, ${event.id}::uuid, 'processed')
            ON CONFLICT (consumer, event_id) DO NOTHING`;
          if (inserted === 0) return 'duplicate';
          await subscriber.handle(event, tx);
          return 'processed';
        }),
    );
  }
}
