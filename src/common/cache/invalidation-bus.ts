import { REDIS } from '@database/redis.module';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Redis } from 'ioredis';

const CHANNEL = 'getpack:cache-invalidation';

type Handler = (key: string) => void;

/**
 * Cross-process cache invalidation over Redis pub/sub (settings, permissions). Every HTTP and
 * worker replica subscribes on bootstrap; local caches also expire on a short TTL, so a missed
 * message only delays a change by that TTL.
 */
@Injectable()
export class InvalidationBus implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(InvalidationBus.name);
  private readonly handlers = new Map<string, Set<Handler>>();
  private subscriber?: Redis;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  on(topic: string, handler: Handler): void {
    const set = this.handlers.get(topic) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(topic, set);
  }

  /** Invalidates locally at once, then tells the other processes. Never throws. */
  async publish(topic: string, key: string): Promise<void> {
    this.dispatch(topic, key);
    try {
      await this.redis.publish(CHANNEL, JSON.stringify({ topic, key, origin: process.pid }));
    } catch {
      this.logger.warn(`cache invalidation for ${topic} not broadcast (Redis unavailable)`);
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    this.subscriber = this.redis.duplicate();
    this.subscriber.on('message', (_channel: string, raw: string) => {
      try {
        const { topic, key } = JSON.parse(raw) as { topic: string; key: string };
        this.dispatch(topic, key);
      } catch {
        // Ignore malformed messages.
      }
    });
    await this.subscriber
      .subscribe(CHANNEL)
      .catch(() => this.logger.warn('cache invalidation not subscribed'));
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.subscriber) return;
    if (this.subscriber.status === 'ready') await this.subscriber.quit().catch(() => undefined);
    else this.subscriber.disconnect();
  }

  private dispatch(topic: string, key: string): void {
    for (const handler of this.handlers.get(topic) ?? []) handler(key);
  }
}
