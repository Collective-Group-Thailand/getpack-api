import { SetMetadata } from '@nestjs/common';

export const ON_DOMAIN_EVENT = 'getpack:on-domain-event';

export interface DomainEventSubscription {
  /** Event types, or `*` for every event (notification routing). */
  types: readonly string[];
  /**
   * Stable consumer name — the idempotency key in `event_consumptions (consumer, event_id)`.
   * Never rename a consumer: a new name would process every retained event again.
   */
  consumer: string;
  /**
   * The Prisma client whose transaction the handler gets (ADR-0013): `erp` for the factory ERP's subscribers,
   * which write ERP tables. Defaults to `core`.
   */
  client?: 'core' | 'erp';
}

/**
 * Marks a provider method `(event: DomainEventEnvelope, tx: Tx) => Promise<void>` as a subscriber — `tx: ErpTx`
 * with `client: 'erp'`.
 * The worker runs it once per event, inside a transaction that also records the consumption, so
 * a redelivered event is skipped (B1 prompt "subscribers idempotent").
 */
export function OnDomainEvent(
  types: string | readonly string[],
  options: { consumer: string; client?: 'core' | 'erp' },
): MethodDecorator {
  const subscription: DomainEventSubscription = {
    types: typeof types === 'string' ? [types] : types,
    consumer: options.consumer,
    client: options.client ?? 'core',
  };
  return SetMetadata(ON_DOMAIN_EVENT, subscription);
}
