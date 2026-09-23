import { AppConfig } from '@config/app-config';
import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis, type RedisOptions } from 'ioredis';

export const REDIS = Symbol('REDIS');

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
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'ready') await this.redis.quit();
    else this.redis.disconnect();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => new Redis(config.get('REDIS_URL'), redisOptions()),
    },
    RedisShutdown,
  ],
  exports: [REDIS],
})
export class RedisModule {}
