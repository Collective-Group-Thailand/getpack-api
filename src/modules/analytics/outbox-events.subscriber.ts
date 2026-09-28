import { type Tx } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

/** Business milestones kept in the analytics event stream (B6.1 "event ingestion from the outbox"). */
export const OUTBOX_ANALYTICS_EVENTS = [
  'customer.registered',
  'order_group.placed',
  'order_group.cancelled',
  'order_group.expired',
  'payment.received',
  'rfq.declined',
  'rfq.expired',
  'production_job.accepted',
  'production_job.rejected',
  'delivery.reconciled',
  'claim.updated',
] as const;

/** Payload keys copied into `properties`: short codes only — no ids, names, amounts or free text. */
const ALLOWED_KEYS = [
  'channel',
  'status',
  'from',
  'to',
  'method',
  'provider',
  'source',
  'outcome',
  'reasonCode',
  'kind',
] as const;

export function outboxProperties(
  event: Pick<DomainEventEnvelope, 'aggregateType' | 'payload'>,
): Record<string, string> {
  const properties: Record<string, string> = { aggregateType: event.aggregateType };
  for (const key of ALLOWED_KEYS) {
    const value = event.payload[key];
    if (typeof value === 'string' && /^[a-z0-9_.-]{1,60}$/.test(value)) properties[key] = value;
  }
  return properties;
}

/**
 * Copies curated domain events into `analytics.raw_events` (source `outbox`): the event id is the domain event
 * id (a redelivery is ignored), no visitor identifier is kept (`consent_state = not_applicable`).
 */
@Injectable()
export class AnalyticsOutboxSubscriber {
  @OnDomainEvent(OUTBOX_ANALYTICS_EVENTS, { consumer: 'analytics.raw-events' })
  async onEvent(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO analytics.raw_events (event_id, occurred_at, source, event_name, consent_state, properties)
      VALUES (${event.id}::uuid, ${new Date(event.occurredAt)}, 'outbox', ${event.type}, 'not_applicable',
              ${JSON.stringify(outboxProperties(event))}::jsonb)
      ON CONFLICT DO NOTHING`;
  }
}
