import { REDIS } from '@database/redis.module';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { type Redis } from 'ioredis';

import { REALTIME_CHANNEL_PREFIX, type RealtimeSignal } from './realtime.publisher';

type Listener = (channel: string, signal: RealtimeSignal) => void;

/**
 * One Redis pattern subscription per HTTP process, fanned out to the open SSE streams of that
 * process. Connects on the first stream, so processes without streams hold no subscriber.
 */
@Injectable()
export class RealtimeHub implements OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeHub.name);
  private readonly listeners = new Map<string, Set<Listener>>();
  private subscriber?: Redis;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async listen(channels: readonly string[], listener: Listener): Promise<() => void> {
    await this.ensureSubscribed();
    for (const channel of channels) {
      const set = this.listeners.get(channel) ?? new Set<Listener>();
      set.add(listener);
      this.listeners.set(channel, set);
    }
    return () => {
      for (const channel of channels) this.listeners.get(channel)?.delete(listener);
    };
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.subscriber?.status === 'ready') await this.subscriber.quit().catch(() => undefined);
    else this.subscriber?.disconnect();
  }

  private async ensureSubscribed(): Promise<void> {
    if (this.subscriber) return;
    this.subscriber = this.redis.duplicate();
    this.subscriber.on('pmessage', (_pattern: string, fullChannel: string, raw: string) => {
      const channel = fullChannel.slice(REALTIME_CHANNEL_PREFIX.length);
      let signal: RealtimeSignal;
      try {
        signal = JSON.parse(raw) as RealtimeSignal;
      } catch {
        return;
      }
      for (const listener of this.listeners.get(channel) ?? []) listener(channel, signal);
    });
    await this.subscriber.psubscribe(`${REALTIME_CHANNEL_PREFIX}*`).catch((error: unknown) => {
      this.logger.warn('realtime subscription failed');
      throw error;
    });
  }
}
