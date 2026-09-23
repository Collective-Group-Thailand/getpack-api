import { join } from 'node:path';

import { ProblemDetailsFilter } from '@common/errors/problem-details.filter';
import { EtagInterceptor } from '@common/etag/etag.interceptor';
import { IdempotencyInterceptor } from '@common/idempotency/idempotency.interceptor';
import { IDEMPOTENCY_STORE } from '@common/idempotency/idempotency.store';
import { InMemoryIdempotencyStore } from '@common/idempotency/in-memory-idempotency.store';
import { buildLoggerParams } from '@common/logging/logger.options';
import { type INestApplication, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AcceptLanguageResolver, I18nModule } from 'nestjs-i18n';
import { LoggerModule } from 'nestjs-pino';

import { configureApp } from '../../src/bootstrap';
import { PipelineTestController } from './pipeline-test.controller';

/**
 * The global HTTP pipeline (filter, validation, idempotency, ETag, request id, i18n) without
 * databases, for fast unit-level HTTP tests. E2E tests use the real AppModule instead.
 */
@Module({
  imports: [
    LoggerModule.forRoot(buildLoggerParams({ level: 'silent', pretty: false, service: 'test' })),
    I18nModule.forRoot({
      fallbackLanguage: 'th',
      loaderOptions: { path: join(__dirname, '..', '..', 'src', 'i18n'), watch: false },
      resolvers: [AcceptLanguageResolver],
    }),
  ],
  controllers: [PipelineTestController],
  providers: [
    { provide: IDEMPOTENCY_STORE, useValue: new InMemoryIdempotencyStore() },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: EtagInterceptor },
  ],
})
class HttpPipelineTestModule {}

export async function createHttpPipelineApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [HttpPipelineTestModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}
