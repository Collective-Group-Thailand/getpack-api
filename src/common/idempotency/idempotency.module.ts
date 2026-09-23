import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IDEMPOTENCY_STORE } from './idempotency.store';
import { PrismaIdempotencyStore } from './prisma-idempotency.store';
import { RedisIdempotencyStore } from './redis-idempotency.store';
import { TieredIdempotencyStore } from './tiered-idempotency.store';

@Global()
@Module({
  providers: [
    RedisIdempotencyStore,
    PrismaIdempotencyStore,
    {
      provide: IDEMPOTENCY_STORE,
      inject: [RedisIdempotencyStore, PrismaIdempotencyStore],
      useFactory: (fast: RedisIdempotencyStore, durable: PrismaIdempotencyStore) =>
        new TieredIdempotencyStore(fast, durable),
    },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [IDEMPOTENCY_STORE, PrismaIdempotencyStore],
})
export class IdempotencyModule {}
