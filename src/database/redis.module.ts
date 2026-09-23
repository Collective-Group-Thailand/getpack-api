import { AppConfig } from '@config/app-config';
import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis, type RedisOptions } from 'ioredis';

export const REDIS = Symbol('REDIS');
/** BullMQ's shared connection (blocking commands need `maxRetriesPerRequest: null`). */
export const BULLMQ_REDIS = Symbol('BULLMQ_REDIS');

/** Options shared by every Redis client. `lazyConnect` lets the contract build boot without Redis. */
export function redisOptions(overrides: RedisOptions = {}): RedisOptions {
  return {
    lazyConnect: true,
    connectTimeout: 2_000,
    maxRetriesPerRequest: 2,
    enableAutoPipelining: true,
    ...overrides,
  };
}

@Injectable()
class RedisShutdown implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(BULLMQ_REDIS) private readonly bullmq: Redis,
  ) {}

  /** Runs after BullMQ workers closed (`onModuleDestroy`), so no job is cut off. */
  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.redis, this.bullmq].map((client) => close(client)));
  }
}

async function close(client: Redis): Promise<void> {
  if (client.status === 'ready') await client.quit().catch(() => client.disconnect());
  else client.disconnect();
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => new Redis(config.get('REDIS_URL'), redisOptions()),
    },
    {
      provide: BULLMQ_REDIS,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        new Redis(
          config.get('REDIS_URL'),
          redisOptions({ maxRetriesPerRequest: null, enableAutoPipelining: false }),
        ),
    },
    RedisShutdown,
  ],
  exports: [REDIS, BULLMQ_REDIS],
})
export class RedisModule {}
