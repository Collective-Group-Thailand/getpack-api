import { join } from 'node:path';

import { RequestContextMiddleware } from '@common/context/request-context.middleware';
import { ProblemDetailsFilter } from '@common/errors/problem-details.filter';
import { EtagInterceptor } from '@common/etag/etag.interceptor';
import { DEFAULT_LANGUAGE } from '@common/i18n/language';
import { IdempotencyModule } from '@common/idempotency/idempotency.module';
import { buildLoggerParams } from '@common/logging/logger.options';
import { AppConfig } from '@config/app-config';
import { AppConfigModule } from '@config/app-config.module';
import { DatabaseModule } from '@database/database.module';
import { RedisModule } from '@database/redis.module';
import { IntegrationsModule } from '@integrations/integrations.module';
import { AuthModule } from '@modules/auth/auth.module';
import { IamModule } from '@modules/iam/iam.module';
import { SurfacesModule } from '@modules/surfaces/surfaces.module';
import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { seconds, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ApprovalsModule } from '@platform/approvals/approvals.module';
import { HealthModule } from '@platform/health/health.module';
import { PlatformCoreModule } from '@platform/platform-core.module';
import { SettingsAdminModule } from '@platform/settings/settings-admin.module';
import { SentryModule } from '@sentry/nestjs/setup';
import { AcceptLanguageResolver, I18nModule } from 'nestjs-i18n';
import { LoggerModule } from 'nestjs-pino';

/** HTTP process (`src/main.ts`). */
@Module({
  imports: [
    SentryModule.forRoot(),
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        buildLoggerParams({
          level: config.get('LOG_LEVEL'),
          pretty: config.get('LOG_PRETTY'),
          service: config.get('OTEL_SERVICE_NAME'),
        }),
    }),
    I18nModule.forRoot({
      fallbackLanguage: DEFAULT_LANGUAGE,
      fallbacks: { 'th-*': 'th', 'en-*': 'en' },
      loaderOptions: { path: join(__dirname, 'i18n'), watch: false },
      resolvers: [AcceptLanguageResolver],
    }),
    ThrottlerModule.forRootAsync({
      imports: [],
      inject: [AppConfig],
      useFactory: (config: AppConfig) => [
        { ttl: seconds(config.get('THROTTLE_TTL_SECONDS')), limit: config.get('THROTTLE_LIMIT') },
      ],
    }),
    DatabaseModule,
    RedisModule,
    IntegrationsModule,
    IdempotencyModule,
    PlatformCoreModule,
    IamModule,
    AuthModule,
    ApprovalsModule,
    SettingsAdminModule,
    HealthModule,
    SurfacesModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: EtagInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
