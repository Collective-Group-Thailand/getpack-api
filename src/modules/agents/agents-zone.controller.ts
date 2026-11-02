import { CurrentActor } from '@common/auth/auth.decorators';
import { Can } from '@common/auth/can.decorator';
import { type Actor, type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess } from '@common/openapi/decorators';
import { WEB_PUSH, type WebPushSender } from '@integrations/web-push/web-push.port';
import { ApiSurface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiParam } from '@nestjs/swagger';
import { SubscribeWebPushDto, VapidKeyDto, WebPushSubscriptionDto } from '@platform/realtime/realtime.dto';
import { WebPushSubscriptionsService } from '@platform/realtime/web-push-subscriptions.service';

import {
  type AgentNotificationPreferences,
  AgentNotificationPreferencesService,
} from './agent-notification-preferences.service';
import { AgentZoneGuard } from './agent-zone.guard';
import {
  AGENT_NOTIFICATION_PREFERENCES_EXAMPLE,
  AgentNotificationPreferencesDto,
  SetAgentNotificationPreferencesDto,
} from './agents.dto';

const DECISIONS = ['D-143', 'D-416', 'D-467'];
const WRITE = ['http.bad_request', 'http.malformed_json', 'validation.failed'] as const;

function customer(actor: Actor): UserActor {
  if (actor.type !== 'user' || actor.audience !== 'customer') throw new DomainException('auth.forbidden');
  return actor;
}

const toDto = (p: AgentNotificationPreferences): AgentNotificationPreferencesDto => ({
  items: p.items,
  reachable: { webPush: p.reachable.web_push, line: p.reachable.line, email: p.reachable.email },
});

/**
 * The agent zone's own settings (agent.getpack.co, D-467): web push for the getpack Agent app and the agent's channel
 * choice per agent event. An active or suspended agent only (`AgentZoneGuard`).
 */
@ApiSurface('store', 'agent')
@Controller('agent')
@UseGuards(AgentZoneGuard)
export class StoreAgentZoneController {
  constructor(
    private readonly subscriptions: WebPushSubscriptionsService,
    private readonly preferences: AgentNotificationPreferencesService,
    @Inject(WEB_PUSH) private readonly sender: WebPushSender,
  ) {}

  @Get('push/vapid-public-key')
  @Can('agent.self')
  @ApiEndpoint({
    id: 'store.agentPush.vapidPublicKey',
    summary: 'VAPID public key for the getpack Agent app',
    description:
      'The key the agent zone’s service worker subscribes with (VAPID keys come from the environment). Null when web ' +
      'push is not configured (D-467, D-143).',
    implements: DECISIONS,
  })
  @ApiSuccess(200, {
    description: 'Key',
    type: VapidKeyDto,
    example: { vapidPublicKey: 'BFakeVapidPublicKey' },
  })
  @ApiStandardErrors('agents.not_agent', 'agents.ended')
  vapidPublicKey(): VapidKeyDto {
    return { vapidPublicKey: this.sender.publicKey };
  }

  @Post('push/subscriptions')
  @Can('agent.self')
  @ApiEndpoint({
    id: 'store.agentPush.subscribe',
    summary: 'Register this browser for agent push',
    description:
      'Registers the agent zone’s browser (getpack Agent PWA) for web push; the auth secret is stored encrypted. ' +
      'Agent events (lead converted, protection ending, commission earned, statement ready, paid, payout details ' +
      'needed) are pushed only to agent-zone browsers, as the agent’s channel choices allow; storefront events never ' +
      'reach them. One subscription per endpoint: a browser registered by another zone or person moves here (D-467).',
    implements: DECISIONS,
  })
  @ApiBody({
    type: SubscribeWebPushDto,
    examples: {
      default: {
        value: {
          endpoint: 'https://push.example.com/subscription/agent-abc123',
          keys: {
            p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
            auth: 'tBHItJI5svbpez7KI4CCXg',
          },
        },
      },
    },
  })
  @ApiSuccess(201, {
    description: 'Registered',
    type: WebPushSubscriptionDto,
    example: { id: '0192f3a0-7c1e-7d2a-9b1f-00000000beef', vapidPublicKey: 'BFakeVapidPublicKey' },
  })
  @ApiStandardErrors(...WRITE, 'agents.not_agent', 'agents.ended')
  async subscribe(
    @CurrentActor() actor: Actor,
    @Body() body: SubscribeWebPushDto,
  ): Promise<WebPushSubscriptionDto> {
    const row = await this.subscriptions.subscribe(
      customer(actor),
      {
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        ...(body.userAgent && { userAgent: body.userAgent }),
      },
      'agent',
    );
    return { id: row.publicId, vapidPublicKey: this.sender.publicKey };
  }

  @Delete('push/subscriptions/:subscriptionId')
  @HttpCode(204)
  @Can('agent.self')
  @ApiParam({ name: 'subscriptionId', format: 'uuid' })
  @ApiEndpoint({
    id: 'store.agentPush.unsubscribe',
    summary: 'Stop agent push to a browser',
    description: 'Only the owner can remove one of their agent-zone subscriptions (D-467).',
    implements: DECISIONS,
  })
  @ApiSuccess(204, { description: 'Removed' })
  @ApiStandardErrors('http.not_found', 'validation.failed', 'agents.not_agent', 'agents.ended')
  async unsubscribe(
    @CurrentActor() actor: Actor,
    @Param('subscriptionId', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.subscriptions.unsubscribe(customer(actor), id, 'agent');
  }

  @Get('notification-preferences')
  @Can('agent.self')
  @ApiEndpoint({
    id: 'store.agentNotificationPreferences.get',
    summary: 'My notification choices',
    description:
      'Every agent event × channel (push to getpack Agent, LINE OA, e-mail) with whether it is on (default on) and ' +
      'whether it is locked: the e-mail of statement ready, payout paid and payout details needed cannot be switched ' +
      'off (payment and tax records, D-144). In-app notifications always stay. `reachable` says whether each ' +
      'channel can reach the agent at all (D-467).',
    implements: [...DECISIONS, 'D-144'],
  })
  @ApiSuccess(200, {
    description: 'Choices',
    type: AgentNotificationPreferencesDto,
    example: AGENT_NOTIFICATION_PREFERENCES_EXAMPLE,
  })
  @ApiStandardErrors('agents.not_agent', 'agents.ended')
  async getPreferences(@CurrentActor() actor: Actor): Promise<AgentNotificationPreferencesDto> {
    return toDto(await this.preferences.get(customer(actor).userId));
  }

  @Put('notification-preferences')
  @Can('agent.self')
  @ApiEndpoint({
    id: 'store.agentNotificationPreferences.set',
    summary: 'Change my notification choices',
    description:
      'Switches channels on or off per agent event; what is not listed keeps its value. A locked e-mail sent with ' +
      '`enabled: false` is refused (`validation.failed`, code `locked`, D-144); an event and channel listed twice ' +
      'too (`duplicate`). Audited and evented (`sales_agent.notification_preferences_changed`). Returns the full ' +
      'matrix (D-467).',
    implements: [...DECISIONS, 'D-144'],
  })
  @ApiBody({
    type: SetAgentNotificationPreferencesDto,
    examples: {
      default: {
        value: {
          items: [
            { event: 'commission_earned', channel: 'line', enabled: false },
            { event: 'lead_protection_expiring', channel: 'web_push', enabled: true },
          ],
        },
      },
    },
  })
  @ApiSuccess(200, {
    description: 'Choices',
    type: AgentNotificationPreferencesDto,
    example: AGENT_NOTIFICATION_PREFERENCES_EXAMPLE,
  })
  @ApiStandardErrors(...WRITE, 'agents.not_agent', 'agents.ended')
  async setPreferences(
    @CurrentActor() actor: Actor,
    @Body() body: SetAgentNotificationPreferencesDto,
  ): Promise<AgentNotificationPreferencesDto> {
    return toDto(await this.preferences.set(customer(actor), body.items));
  }
}
