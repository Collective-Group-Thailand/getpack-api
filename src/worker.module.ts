import { buildLoggerParams } from '@common/logging/logger.options';
import { AppConfig } from '@config/app-config';
import { AppConfigModule } from '@config/app-config.module';
import { DatabaseModule } from '@database/database.module';
import { BULLMQ_REDIS, RedisModule } from '@database/redis.module';
import { IntegrationsModule } from '@integrations/integrations.module';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DomainEventsWorkerModule } from '@platform/domain-events/domain-events-worker.module';
import { PlatformCoreModule } from '@platform/platform-core.module';
import { type Redis } from 'ioredis';
import { LoggerModule } from 'nestjs-pino';

import { WorkerLifecycle } from './worker.lifecycle';

/**
 * Worker process (`src/worker.ts`): outbox relay, BullMQ consumers and repeatable jobs.
 * Business modules add subscribers (`@OnDomainEvent`) and jobs (`@ScheduledJob`) by being imported here.
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
    RedisModule,
    BullModule.forRootAsync({
      inject: [BULLMQ_REDIS],
      useFactory: (connection: Redis) => ({ prefix: 'packio', connection }),
    }),
    DatabaseModule,
    IntegrationsModule,
    PlatformCoreModule,
    DomainEventsWorkerModule,
  ],
  providers: [WorkerLifecycle],
})
export class WorkerModule {}
