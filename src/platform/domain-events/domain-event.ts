/**
 * Domain event envelope (B1 prompt "Outbox & events"). Internal ids are strings because the envelope
 * travels through Redis as JSON; they never leave the API.
 */
export interface DomainEventEnvelope<P = Record<string, unknown>> {
  id: string;
  /** Dotted, past tense: `approval.approved`, `setting.changed`. */
  type: string;
  aggregateType: string;
  /** Public id (uuid) of the aggregate. */
  aggregateId: string;
  entityId: string | null;
  actor: { type: 'user' | 'api_client' | 'system' | 'webhook'; userId?: string; apiClientId?: string };
  occurredAt: string;
  correlationId: string;
  causationId: string | null;
  payloadSchemaVersion: number;
  payload: P;
}

export interface NewDomainEvent<P = Record<string, unknown>> {
  type: string;
  aggregateType: string;
  aggregateId: string;
  entityId?: bigint | null;
  payload: P;
  payloadSchemaVersion?: number;
  occurredAt?: Date;
}

/** Outbox topic = the event family (`approval.approved` → `approval`). */
export function topicOf(type: string): string {
  return type.split('.')[0] ?? type;
}

/** Rebuilds the envelope from a stored `domain_events` row. */
export function envelopeFromRow(row: {
  id: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  entityId: bigint | null;
  actorType: 'user' | 'api_client' | 'system' | 'webhook';
  actorUserId: bigint | null;
  actorApiClientId: bigint | null;
  occurredAt: Date;
  correlationId: string;
  causationId: string | null;
  payloadSchemaVersion: number;
  payload: unknown;
}): DomainEventEnvelope {
  return {
    id: row.id,
    type: row.type,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    entityId: row.entityId?.toString() ?? null,
    actor: {
      type: row.actorType,
      ...(row.actorUserId !== null && { userId: row.actorUserId.toString() }),
      ...(row.actorApiClientId !== null && { apiClientId: row.actorApiClientId.toString() }),
    },
    occurredAt: row.occurredAt.toISOString(),
    correlationId: row.correlationId,
    causationId: row.causationId,
    payloadSchemaVersion: row.payloadSchemaVersion,
    payload: (row.payload ?? {}) as Record<string, unknown>,
  };
}
