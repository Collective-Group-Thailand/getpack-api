import { WEB_PUSH, type WebPushSender } from '@collective/integrations/web-push';
import { CurrentActor } from '@common/auth/auth.decorators';
import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { ApiEndpoint, ApiStandardErrors, ApiSuccess, ApiUnthrottled } from '@common/openapi/decorators';
import { toBangkokIso } from '@common/time/bangkok';
import { ApiSurface, type Surface } from '@modules/surfaces/surfaces';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  type MessageEvent,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Sse,
  type Type,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiProduces, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { type Request } from 'express';
import { Observable } from 'rxjs';

import { RealtimeAuthDto, SubscribeWebPushDto, VapidKeyDto, WebPushSubscriptionDto } from './realtime.dto';
import { RealtimeHub } from './realtime-hub';
import { RealtimeStreamGuard, STREAM_CHANNELS } from './realtime-stream.guard';
import { RealtimeTokens } from './realtime-tokens';
import { WebPushSubscriptionsService } from './web-push-subscriptions.service';

type ZoneSurface = Extract<Surface, 'store' | 'admin' | 'partner'>;
const HEARTBEAT_MS = 25_000;

const userActor = (actor: Actor) => {
  if (actor.type !== 'user') throw new DomainException('auth.forbidden');
  return actor;
};
const named = <T>(cls: T, name: string): T => Object.defineProperty(cls, 'name', { value: name });
const title = (surface: ZoneSurface) => `${surface[0]!.toUpperCase()}${surface.slice(1)}`;

/** Realtime (contract §6): authorise, then stream ids + type only over SSE; clients refetch. */
function realtimeController(surface: ZoneSurface): Type<unknown> {
  @ApiSurface(surface, 'realtime')
  @Controller('realtime')
  class RealtimeController {
    constructor(
      readonly tokens: RealtimeTokens,
      readonly hub: RealtimeHub,
    ) {}

    @Post('auth')
    @HttpCode(200)
    @ApiEndpoint({
      id: `${surface}.realtime.auth`,
      summary: 'Authorise a realtime stream',
      description:
        'Returns a 60-second token for the channels of the signed-in principal (own user, factory/company scopes).',
      implements: ['ADR-0003'],
    })
    @ApiSuccess(200, {
      description: 'Stream token',
      type: RealtimeAuthDto,
      example: {
        token: 'eyJhbGciOiJFZERTQSIsInR5cCI6InJ0K2p3dCJ9.eyJjaCI6W119.c2ln',
        expiresAt: '2026-09-23T14:06:00+07:00',
        channels: ['user:0192f3a0-7c1e-7d2a-9b1f-3c4d5e6f7a8b'],
        streamPath: `/v1/${surface}/realtime/stream`,
      },
    })
    @ApiStandardErrors('http.not_found')
    async auth(@CurrentActor() actor: Actor): Promise<RealtimeAuthDto> {
      const issued = await this.tokens.issue(actor, surface);
      return {
        token: issued.token,
        expiresAt: toBangkokIso(issued.expiresAt),
        channels: issued.channels,
        streamPath: `/v1/${surface}/realtime/stream`,
      };
    }

    @Get('stream')
    @UseGuards(RealtimeStreamGuard)
    @SkipThrottle()
    @ApiUnthrottled()
    @Sse()
    @ApiProduces('text/event-stream')
    @ApiQuery({ name: 'token', required: true, description: 'From `POST …/realtime/auth`' })
    @ApiEndpoint({
      id: `${surface}.realtime.stream`,
      summary: 'Server-sent events for the signed-in principal',
      description:
        'Called with the bearer token (the BFF proxies the stream) and the channel token from `POST …/realtime/auth`. ' +
        'Events carry `{ type, id?, channel }` only — never business data; the client refetches through the API ' +
        '(contract §6). A heartbeat event keeps proxies from closing the connection.',
      implements: ['ADR-0003'],
    })
    @ApiResponse({
      status: 200,
      description: 'Event stream',
      content: {
        'text/event-stream': {
          schema: { type: 'string' },
          example:
            'event: notification.created\ndata: {"type":"notification.created","id":"0192f3a0-7c1e-7d2a-9b1f-00000000e001","channel":"user:0192f3a0-7c1e-7d2a-9b1f-3c4d5e6f7a8b"}\n\n',
        },
      },
    })
    @ApiStandardErrors('auth.unauthenticated', 'validation.failed')
    stream(@Req() req: Request & { [STREAM_CHANNELS]?: string[] }): Observable<MessageEvent> {
      const channels = req[STREAM_CHANNELS] ?? [];
      return new Observable<MessageEvent>((subscriber) => {
        let unsubscribe: (() => void) | undefined;
        void this.hub
          .listen(channels, (channel, signal) =>
            subscriber.next({ type: signal.type, data: { ...signal, channel } }),
          )
          .then((stop) => {
            unsubscribe = stop;
            subscriber.next({ type: 'ready', data: { type: 'ready', channels } });
          })
          .catch((error: unknown) => subscriber.error(error));
        const heartbeat = setInterval(
          () => subscriber.next({ type: 'heartbeat', data: { type: 'heartbeat' } }),
          HEARTBEAT_MS,
        );
        return () => {
          clearInterval(heartbeat);
          unsubscribe?.();
        };
      });
    }
  }
  return named(RealtimeController, `${title(surface)}RealtimeController`);
}

/** Web push (VAPID) subscriptions of the signed-in user (D-143). */
function webPushController(surface: ZoneSurface): Type<unknown> {
  @ApiSurface(surface, 'webPush')
  @Controller('web-push')
  class WebPushController {
    constructor(
      readonly subscriptions: WebPushSubscriptionsService,
      @Inject(WEB_PUSH) readonly sender: WebPushSender,
    ) {}

    @Get('vapid-public-key')
    @ApiEndpoint({
      id: `${surface}.webPush.vapidPublicKey`,
      summary: 'VAPID public key for subscribing',
      description: 'Null when web push is not configured.',
      implements: ['D-143'],
    })
    @ApiSuccess(200, {
      description: 'Key',
      type: VapidKeyDto,
      example: { vapidPublicKey: 'BFakeVapidPublicKey' },
    })
    @ApiStandardErrors('http.not_found')
    vapidPublicKey(): VapidKeyDto {
      return { vapidPublicKey: this.sender.publicKey };
    }

    @Post('subscriptions')
    @ApiEndpoint({
      id: `${surface}.webPush.subscribe`,
      summary: 'Register this browser for web push',
      description:
        'One subscription per endpoint; the auth secret is stored encrypted. Sent only when the user permits it (D-143).',
      implements: ['D-143'],
    })
    @ApiBody({
      type: SubscribeWebPushDto,
      examples: {
        default: {
          value: {
            endpoint: 'https://push.example.com/subscription/abc123',
            keys: {
              p256dh:
                'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
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
    @ApiStandardErrors('http.bad_request', 'http.malformed_json', 'validation.failed')
    async subscribe(
      @CurrentActor() actor: Actor,
      @Body() body: SubscribeWebPushDto,
    ): Promise<WebPushSubscriptionDto> {
      const row = await this.subscriptions.subscribe(userActor(actor), {
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        ...(body.userAgent && { userAgent: body.userAgent }),
      });
      return { id: row.publicId, vapidPublicKey: this.sender.publicKey };
    }

    @Delete('subscriptions/:subscriptionId')
    @HttpCode(204)
    @ApiEndpoint({
      id: `${surface}.webPush.unsubscribe`,
      summary: 'Stop web push to a browser',
      description: 'Only the owner can remove it.',
      implements: ['D-143'],
    })
    @ApiSuccess(204, { description: 'Removed' })
    @ApiStandardErrors('http.not_found', 'validation.failed')
    async unsubscribe(
      @CurrentActor() actor: Actor,
      @Param('subscriptionId', ParseUUIDPipe) id: string,
    ): Promise<void> {
      await this.subscriptions.unsubscribe(userActor(actor), id);
    }
  }
  return named(WebPushController, `${title(surface)}WebPushController`);
}

export const StoreRealtimeController = realtimeController('store');
export const AdminRealtimeController = realtimeController('admin');
export const PartnerRealtimeController = realtimeController('partner');
export const StoreWebPushController = webPushController('store');
export const AdminWebPushController = webPushController('admin');
export const PartnerWebPushController = webPushController('partner');
