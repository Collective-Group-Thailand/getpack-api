import { type Actor, actorColumns } from '@common/context/actor';
import { RequestContext } from '@common/context/request-context';
import { uuidv7 } from '@common/ids/uuidv7';
import { jsonSafe } from '@common/json/json-safe';
import { type Tx } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';

import { type DomainEventEnvelope, type NewDomainEvent, topicOf } from './domain-event';

/**
 * `DomainEvents.record(tx, event)` — writes `domain_events` + `outbox_messages` in the caller's
 * transaction (transactional outbox, schema-design §2.6). The worker relay publishes them; every
 * notification, ledger posting and analytics fact is a subscriber (CLAUDE.md hard rules).
 */
@Injectable()
export class DomainEvents {
  async record<P extends Record<string, unknown>>(
    tx: Tx,
    event: NewDomainEvent<P>,
    actor?: Actor,
  ): Promise<DomainEventEnvelope<P>> {
    const context = RequestContext.current();
    const who = actor ?? context?.actor ?? { type: 'system' as const, name: 'unknown' };
    const columns = actorColumns(who);
    const id = uuidv7();
    const occurredAt = event.occurredAt ?? new Date();
    const correlationId = context?.correlationId ?? id;
    const causationId = context?.causationId ?? null;
    const payloadSchemaVersion = event.payloadSchemaVersion ?? 1;

    await tx.domainEvent.create({
      data: {
        id,
        type: event.type,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        entityId: event.entityId ?? null,
        ...columns,
        occurredAt,
        correlationId,
        causationId,
        payload: jsonSafe(event.payload),
        payloadSchemaVersion,
      },
    });
    await tx.outboxMessage.create({ data: { eventId: id, topic: topicOf(event.type) } });

    return {
      id,
      type: event.type,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      entityId: event.entityId?.toString() ?? null,
      actor: {
        type: columns.actorType,
        ...(columns.actorUserId !== null && { userId: columns.actorUserId.toString() }),
        ...(columns.actorApiClientId !== null && { apiClientId: columns.actorApiClientId.toString() }),
      },
      occurredAt: occurredAt.toISOString(),
      correlationId,
      causationId,
      payloadSchemaVersion,
      payload: jsonSafe(event.payload) as unknown as P,
    };
  }
}
