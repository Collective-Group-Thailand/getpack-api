import { type Actor, actorColumns } from '@common/context/actor';
import { RequestContext } from '@common/context/request-context';
import { jsonSafe } from '@common/json/json-safe';
import { type Tx } from '@database/prisma.service';
import { type ActivityVisibility } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';

export interface ActivityEntry {
  aggregateType: string;
  aggregatePublicId: string;
  /** Stable key, e.g. `order.cancelled`. */
  action: string;
  /** i18n key + params rendered by the timeline. */
  messageKey: string;
  messageParams?: Record<string, unknown>;
  visibility?: ActivityVisibility[];
  entityId?: bigint;
  domainEventId?: string;
  data?: Record<string, unknown>;
  actor?: Actor;
}

/** Human-readable timeline row written with every state change (schema-design §2.6). */
@Injectable()
export class ActivityLogService {
  async record(tx: Tx, entry: ActivityEntry): Promise<void> {
    const actor = entry.actor ?? RequestContext.actor() ?? { type: 'system' as const, name: 'unknown' };
    await tx.activityLog.create({
      data: {
        ...actorColumns(actor),
        onBehalfOfUserId: actor.type === 'user' ? (actor.onBehalfOfUserId ?? null) : null,
        entityId: entry.entityId ?? null,
        aggregateType: entry.aggregateType,
        aggregatePublicId: entry.aggregatePublicId,
        action: entry.action,
        visibility: entry.visibility ?? ['internal'],
        messageKey: entry.messageKey,
        messageParams: jsonSafe(entry.messageParams ?? {}),
        domainEventId: entry.domainEventId ?? null,
        data: jsonSafe(entry.data ?? {}),
      },
    });
  }
}
