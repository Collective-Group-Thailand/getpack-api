import { buildLoggerParams } from '@common/logging/logger.options';
import { AppConfig } from '@config/app-config';
import { AppConfigModule } from '@config/app-config.module';
import { redisOptions } from '@database/redis.module';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { LoggerModule } from 'nestjs-pino';

import { WorkerLifecycle } from './worker.lifecycle';

/**
 * Worker process (`src/worker.ts`): outbox relay, BullMQ consumers and repeatable jobs.
 * Queues and processors are registered by the deliverables that own them (outbox relay: B1.3).
 */
@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        buildLoggerParams({
          level: config.get('LOG_LEVEL'),
          pretty: config.get('LOG_PRETTY'),
          service: `${config.get('OTEL_SERVICE_NAME')}-worker`,
        }),
    }),
    BullModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        prefix: 'packio',
        // BullMQ workers need `maxRetriesPerRequest: null` (blocking commands).
        connection: new Redis(config.get('REDIS_URL'), redisOptions({ maxRetriesPerRequest: null })),
      }),
    }),
  ],
  providers: [WorkerLifecycle],
})
export class WorkerModule {}
