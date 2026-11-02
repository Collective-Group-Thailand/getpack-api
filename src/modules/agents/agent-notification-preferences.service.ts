import { type UserActor } from '@common/context/actor';
import { PrismaService } from '@database/prisma.service';
import { type SalesAgentNotificationEvent } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { AuditService } from '@platform/audit/audit.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import {
  AGENT_NOTIFICATION_CHANNELS,
  AGENT_NOTIFICATION_EVENT_KEYS,
  type AgentNotificationChannel,
  isLockedAgentChannel,
} from '@platform/notifications/agent-notification-events';

import { invalid, recordAgentEvent } from './agent-shared';
import { AgentsService } from './agents.service';

export interface AgentNotificationPreferenceItem {
  event: SalesAgentNotificationEvent;
  channel: AgentNotificationChannel;
  enabled: boolean;
  locked: boolean;
}

export interface AgentNotificationPreferences {
  items: AgentNotificationPreferenceItem[];
  /** Whether each channel can reach the agent at all (a LINE account linked, a push-enabled agent-zone browser, an e-mail). */
  reachable: Record<AgentNotificationChannel, boolean>;
}

/** The full matrix event × channel with defaults (on) and the locked e-mails (D-144). Pure; unit-tested. */
export function preferenceMatrix(
  stored: readonly { event: SalesAgentNotificationEvent; channel: string; enabled: boolean }[],
): AgentNotificationPreferenceItem[] {
  return AGENT_NOTIFICATION_EVENT_KEYS.flatMap((event) =>
    AGENT_NOTIFICATION_CHANNELS.map((channel) => {
      const locked = isLockedAgentChannel(event, channel);
      const row = stored.find((r) => r.event === event && r.channel === channel);
      return { event, channel, enabled: locked || (row?.enabled ?? true), locked };
    }),
  );
}

/**
 * D-467: an agent chooses, per agent event, which of push (agent zone), LINE OA and e-mail reach them; in-app always
 * stays. Only changes are stored; the notification router reads them.
 */
@Injectable()
export class AgentNotificationPreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: AgentsService,
    private readonly audit: AuditService,
    readonly events: DomainEvents,
    readonly activity: ActivityLogService,
  ) {}

  async get(userId: bigint): Promise<AgentNotificationPreferences> {
    const agent = await this.agents.mine(userId);
    const [stored, line, push, user] = await Promise.all([
      this.prisma.salesAgentNotificationPreference.findMany({ where: { agentId: agent.id } }),
      this.prisma.userIdentity.count({ where: { userId, provider: 'line', unlinkedAt: null } }),
      this.prisma.webPushSubscription.count({ where: { userId, client: 'agent', revokedAt: null } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } }),
    ]);
    return {
      items: preferenceMatrix(stored),
      reachable: { web_push: push > 0, line: line > 0, email: user.email !== null },
    };
  }

  async set(
    actor: UserActor,
    items: readonly {
      event: SalesAgentNotificationEvent;
      channel: AgentNotificationChannel;
      enabled: boolean;
    }[],
  ): Promise<AgentNotificationPreferences> {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      const key = `${item.event}:${item.channel}`;
      if (seen.has(key)) invalid(`items[${i}]`, 'This event and channel are listed twice', 'duplicate');
      seen.add(key);
      if (!item.enabled && isLockedAgentChannel(item.event, item.channel))
        invalid(`items[${i}].enabled`, 'Payment and tax e-mails cannot be switched off (D-144)', 'locked');
    });
    const agent = await this.agents.mine(actor.userId);
    await this.prisma.withTx(async (tx) => {
      const before = await tx.salesAgentNotificationPreference.findMany({ where: { agentId: agent.id } });
      const changed = items.filter((item) => {
        const row = before.find((r) => r.event === item.event && r.channel === item.channel);
        return (row?.enabled ?? true) !== item.enabled;
      });
      if (changed.length === 0) return;
      for (const item of changed) {
        await tx.salesAgentNotificationPreference.upsert({
          where: { agentId_event_channel: { agentId: agent.id, event: item.event, channel: item.channel } },
          create: { agentId: agent.id, event: item.event, channel: item.channel, enabled: item.enabled },
          update: { enabled: item.enabled },
        });
      }
      const changes = changed.map((c) => ({ event: c.event, channel: c.channel, enabled: c.enabled }));
      await this.audit.record(tx, {
        category: 'config',
        action: 'sales_agent.notification_preferences_changed',
        actor,
        resourceType: 'sales_agent',
        resourcePublicId: agent.publicId,
        data: { changes },
      });
      await recordAgentEvent(this, tx, {
        type: 'sales_agent.notification_preferences_changed',
        aggregateType: 'sales_agent',
        aggregateId: agent.publicId,
        payload: { agentId: agent.publicId, changes },
        actor,
      });
    });
    return this.get(actor.userId);
  }
}
