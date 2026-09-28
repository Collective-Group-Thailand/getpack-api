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
import { ArtworkModule } from '@modules/artwork/artwork.module';
import { AuthModule } from '@modules/auth/auth.module';
import { CartsModule } from '@modules/carts/carts.module';
import { CatalogModule } from '@modules/catalog/catalog.module';
import { CheckoutModule } from '@modules/checkout/checkout.module';
import { ClaimsModule } from '@modules/claims/claims.module';
import { CompaniesModule } from '@modules/companies/companies.module';
import { ConversationsModule } from '@modules/conversations/conversations.module';
import { CustomersModule } from '@modules/customers/customers.module';
import { DesignServicesModule } from '@modules/design-services/design-services.module';
import { DesignsModule } from '@modules/designs/designs.module';
import { DiscountMemosModule } from '@modules/discount-memos/discount-memos.module';
import { IamModule } from '@modules/iam/iam.module';
import { LedgerModule } from '@modules/ledger/ledger.module';
import { LogisticsModule } from '@modules/logistics/logistics.module';
import { LoyaltyModule } from '@modules/loyalty/loyalty.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { PartnersModule } from '@modules/partners/partners.module';
import { PaymentSchedulesModule } from '@modules/payment-schedules/payment-schedules.module';
import { PaymentsModule } from '@modules/payments/payments.module';
import { PricingModule } from '@modules/pricing/pricing.module';
import { ProductionModule } from '@modules/production/production.module';
import { PromotionsModule } from '@modules/promotions/promotions.module';
import { QuotesModule } from '@modules/quotes/quotes.module';
import { RfqModule } from '@modules/rfq/rfq.module';
import { ShippingModule } from '@modules/shipping/shipping.module';
import { SurfacesModule } from '@modules/surfaces/surfaces.module';
import { TimelineModule } from '@modules/timeline/timeline.module';
import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { seconds, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ApprovalsModule } from '@platform/approvals/approvals.module';
import { FilesModule } from '@platform/files/files.module';
import { HealthModule } from '@platform/health/health.module';
import { NotificationsModule } from '@platform/notifications/notifications.module';
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
    NotificationsModule,
    FilesModule,
    SettingsAdminModule,
    CatalogModule,
    PartnersModule,
    PricingModule,
    ShippingModule,
    QuotesModule,
    RfqModule,
    CustomersModule,
    CartsModule,
    CheckoutModule,
    OrdersModule,
    PaymentSchedulesModule,
    PromotionsModule,
    LoyaltyModule,
    CompaniesModule,
    DiscountMemosModule,
    PaymentsModule,
    ArtworkModule,
    DesignServicesModule,
    DesignsModule,
    ProductionModule,
    LogisticsModule,
    TimelineModule,
    ClaimsModule,
    ConversationsModule,
    LedgerModule,
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
