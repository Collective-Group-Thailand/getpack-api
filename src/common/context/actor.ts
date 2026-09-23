import { type Audience } from '@modules/surfaces/surfaces';

/**
 * Who performs an action (schema-design §2.10). Internal `bigint` ids stay inside the API; the
 * public ids are what tokens and responses carry.
 */
export type Actor = UserActor | ApiClientActor | SystemActor | WebhookActor;

export interface UserActor {
  type: 'user';
  userId: bigint;
  publicId: string;
  audience: Audience;
  /** Session family id (`sid`), absent for actors built outside a request. */
  sessionId?: string;
  /** Token scopes, e.g. `factory:<uuid>`, `company:<uuid>`. */
  scopes: readonly string[];
  /** CS acting for a customer (schema-design §2.10). */
  onBehalfOfUserId?: bigint;
}

export interface ApiClientActor {
  type: 'api_client';
  apiClientId: bigint;
  publicId: string;
  audience: 'partner';
  scopes: readonly string[];
}

export interface SystemActor {
  type: 'system';
  /** Job or subsystem name, for logs only. */
  name: string;
}

export interface WebhookActor {
  type: 'webhook';
  provider: string;
}

export const systemActor = (name: string): SystemActor => ({ type: 'system', name });

/** The actor columns shared by audit/activity logs and domain events (check constraint `ck_*__actor`). */
export interface ActorColumns {
  actorType: 'user' | 'api_client' | 'system' | 'webhook';
  actorUserId: bigint | null;
  actorApiClientId: bigint | null;
}

export function actorColumns(actor: Actor): ActorColumns {
  switch (actor.type) {
    case 'user':
      return { actorType: 'user', actorUserId: actor.userId, actorApiClientId: null };
    case 'api_client':
      return { actorType: 'api_client', actorUserId: null, actorApiClientId: actor.apiClientId };
    default:
      return { actorType: actor.type, actorUserId: null, actorApiClientId: null };
  }
}

/** Stable per-principal key (idempotency scopes, rate limits); never an internal id. */
export function actorKey(actor: Actor | undefined): string {
  if (!actor) return 'anonymous';
  switch (actor.type) {
    case 'user':
      return `${actor.audience}:${actor.publicId}`;
    case 'api_client':
      return `client:${actor.publicId}`;
    case 'system':
      return `system:${actor.name}`;
    case 'webhook':
      return `webhook:${actor.provider}`;
  }
}
