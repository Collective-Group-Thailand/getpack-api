import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IDEMPOTENCY_STORE } from './idempotency.store';
import { RedisIdempotencyStore } from './redis-idempotency.store';

@Global()
@Module({
  providers: [
    { provide: IDEMPOTENCY_STORE, useClass: RedisIdempotencyStore },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [IDEMPOTENCY_STORE],
})
export class IdempotencyModule {}
