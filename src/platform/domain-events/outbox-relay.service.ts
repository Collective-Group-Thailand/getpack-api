import { PrismaService } from '@database/prisma.service';
import { Injectable, Logger } from '@nestjs/common';

import { type DomainEventEnvelope, envelopeFromRow } from './domain-event';
import { SubscriberRegistry } from './subscriber-registry';

/** Hands one (consumer, event) pair to the queue; implemented with BullMQ in the worker. */
export abstract class SubscriberDispatcher {
  /** `dispatchNo` makes queue job ids unique per dispatch, so a replay is never deduplicated away. */
  abstract dispatch(
    jobs: { consumer: string; event: DomainEventEnvelope }[],
    dispatchNo: number,
  ): Promise<void>;
}

export const RELAY_MAX_ATTEMPTS = 10;

/** 2 s, 4 s, 8 s … capped at 10 minutes. */
export function relayBackoffMs(attempts: number): number {
  return Math.min(2_000 * 2 ** Math.max(attempts - 1, 0), 600_000);
}

/**
 * Moves committed outbox rows to the subscriber queue. Rows are claimed with
 * `FOR UPDATE SKIP LOCKED`, so any number of relays can run without dispatching a row twice;
 * duplicates that slip through (crash after enqueue, before commit) are absorbed by
 * `event_consumptions`.
 */
@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: SubscriberRegistry,
    private readonly dispatcher: SubscriberDispatcher,
  ) {}

  /** Relays up to `limit` due rows; returns how many were claimed. */
  async relayBatch(limit = 100): Promise<number> {
    return this.prisma.withTx(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: bigint; attempts: number }[]>`
        SELECT id, attempts FROM outbox_messages
         WHERE status IN ('pending', 'failed') AND next_attempt_at <= now()
         ORDER BY next_attempt_at, id
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED`;
      if (claimed.length === 0) return 0;

      const messages = await tx.outboxMessage.findMany({
        where: { id: { in: claimed.map((c) => c.id) } },
        include: { event: true },
      });
      for (const message of messages) {
        const event = envelopeFromRow(message.event);
        const jobs = this.registry.forType(event.type).map((s) => ({ consumer: s.consumer, event }));
        try {
          if (jobs.length > 0) await this.dispatcher.dispatch(jobs, message.attempts + 1);
          await tx.outboxMessage.update({
            where: { id: message.id },
            data: {
              status: 'dispatched',
              dispatchedAt: new Date(),
              attempts: { increment: 1 },
              lastError: null,
            },
          });
        } catch (error) {
          const attempts = message.attempts + 1;
          const dead = attempts >= RELAY_MAX_ATTEMPTS;
          this.logger.warn(`outbox ${event.id} dispatch failed (attempt ${attempts})`);
          await tx.outboxMessage.update({
            where: { id: message.id },
            data: {
              status: dead ? 'dead' : 'failed',
              attempts,
              nextAttemptAt: new Date(Date.now() + relayBackoffMs(attempts)),
              lastError: errorText(error),
            },
          });
        }
      }
      return claimed.length;
    });
  }

  /** Called when a subscriber exhausted its retries: the event lands in the dead-letter list. */
  async markDead(eventId: string, consumer: string, error: unknown): Promise<void> {
    await this.prisma.outboxMessage.updateMany({
      where: { eventId },
      data: { status: 'dead', lastError: `${consumer}: ${errorText(error)}` },
    });
  }
}

export function errorText(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.slice(0, 2_000);
}
