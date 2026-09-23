/** BullMQ queues of the worker process (prefix `packio`). */
export const QUEUES = {
  outboxRelay: 'outbox-relay',
  domainEvents: 'domain-events',
  maintenance: 'maintenance',
} as const;

export interface DomainEventJob {
  consumer: string;
  event: import('../domain-event').DomainEventEnvelope;
}

/** Subscriber retries before the event is dead-lettered (then replayed by an admin). */
export const SUBSCRIBER_ATTEMPTS = 8;
