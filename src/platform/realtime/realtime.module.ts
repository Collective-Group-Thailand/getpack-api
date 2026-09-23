import { Module } from '@nestjs/common';

import { RealtimeHub } from './realtime-hub';
import { RealtimeStreamGuard } from './realtime-stream.guard';
import { RealtimeTokens } from './realtime-tokens';
import { WebPushSubscriptionsService } from './web-push-subscriptions.service';

/**
 * HTTP-side realtime: SSE streams, channel tokens and web-push subscriptions. The publisher lives
 * in `NotificationsModule` so the worker can signal without serving streams.
 */
@Module({
  providers: [RealtimeHub, RealtimeTokens, RealtimeStreamGuard, WebPushSubscriptionsService],
  exports: [RealtimeHub, RealtimeTokens, WebPushSubscriptionsService],
})
export class RealtimeModule {}
