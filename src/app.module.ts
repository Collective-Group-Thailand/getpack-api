import { join } from 'node:path';

import { RequestContextMiddleware } from '@common/context/request-context.middleware';
import { DeprecationInterceptor } from '@common/deprecation/deprecation';
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
import { AdvisoryModule } from '@modules/advisory/advisory.module';
import { AgentsModule } from '@modules/agents/agents.module';
import { AnalyticsModule } from '@modules/analytics/analytics.module';
import { ArtworkModule } from '@modules/artwork/artwork.module';
import { AssistantApiModule, AssistantModule } from '@modules/assistant/assistant.module';
import { AuditSupportModule } from '@modules/audit-support/audit-support.module';
import { AuthModule } from '@modules/auth/auth.module';
import { B2bModule } from '@modules/b2b/b2b.module';
import { BankingModule } from '@modules/banking/banking.module';
import { CallOffsModule } from '@modules/call-offs/call-offs.module';
import { CartsModule } from '@modules/carts/carts.module';
import { CatalogModule } from '@modules/catalog/catalog.module';
import { StorefrontRevalidationModule } from '@modules/catalog/store/revalidation';
import { CheckoutModule } from '@modules/checkout/checkout.module';
import { ClaimsModule } from '@modules/claims/claims.module';
import { CloseModule } from '@modules/close/close.module';
import { CompaniesModule } from '@modules/companies/companies.module';
import { ConversationsModule } from '@modules/conversations/conversations.module';
import { CustomersModule } from '@modules/customers/customers.module';
import { DesignServicesModule } from '@modules/design-services/design-services.module';
import { DesignsModule } from '@modules/designs/designs.module';
import { DiscountMemosModule } from '@modules/discount-memos/discount-memos.module';
import { FactoryErpModule } from '@modules/factory-erp/factory-erp.module';
import { FinancialReportsModule } from '@modules/financial-reports/financial-reports.module';
import { FixedAssetsModule } from '@modules/fixed-assets/fixed-assets.module';
import { IamModule } from '@modules/iam/iam.module';
import { LaunchpadModule } from '@modules/launchpad/launchpad.module';
import { LedgerModule } from '@modules/ledger/ledger.module';
import { LogisticsModule } from '@modules/logistics/logistics.module';
import { LoyaltyModule } from '@modules/loyalty/loyalty.module';
import { OpsModule } from '@modules/ops/ops.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { PartnersModule } from '@modules/partners/partners.module';
import { PayablesModule } from '@modules/payables/payables.module';
import { PaymentSchedulesModule } from '@modules/payment-schedules/payment-schedules.module';
import { PaymentsModule } from '@modules/payments/payments.module';
import { PayoutsModule } from '@modules/payouts/payouts.module';
import { PricingModule } from '@modules/pricing/pricing.module';
import { ProductionModule } from '@modules/production/production.module';
import { PromotionsModule } from '@modules/promotions/promotions.module';
import { QuotesModule } from '@modules/quotes/quotes.module';
import { ReceivablesModule } from '@modules/receivables/receivables.module';
import { ReordersModule } from '@modules/reorders/reorders.module';
import { ReportsModule } from '@modules/reports/reports.module';
import { RfqModule } from '@modules/rfq/rfq.module';
import { RfqBasketsModule } from '@modules/rfq/rfq-baskets.module';
import { SamplesModule } from '@modules/samples/samples.module';
import { ShippingModule } from '@modules/shipping/shipping.module';
import { StudioModule } from '@modules/studio/studio.module';
import { StylesModule } from '@modules/styles/styles.module';
import { SurfacesModule } from '@modules/surfaces/surfaces.module';
import { TaxModule } from '@modules/tax/tax.module';
import { TimelineModule } from '@modules/timeline/timeline.module';
import { ToolingModule } from '@modules/tooling/tooling.module';
import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { seconds, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ApprovalsModule } from '@platform/approvals/approvals.module';
import { FileSearchModule } from '@platform/file-search/file-search.module';
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
    FileSearchModule,
    SettingsAdminModule,
    CatalogModule,
    StorefrontRevalidationModule,
    PartnersModule,
    PricingModule,
    ShippingModule,
    QuotesModule,
    AdvisoryModule,
    SamplesModule,
    StylesModule,
    StudioModule,
    RfqModule,
    RfqBasketsModule,
    CustomersModule,
    CartsModule,
    CheckoutModule,
    OrdersModule,
    ToolingModule,
    ReordersModule,
    LaunchpadModule,
    AssistantModule,
    AssistantApiModule,
    CallOffsModule,
    B2bModule,
    PaymentSchedulesModule,
    PromotionsModule,
    LoyaltyModule,
    AgentsModule,
    CompaniesModule,
    DiscountMemosModule,
    PaymentsModule,
    ArtworkModule,
    DesignServicesModule,
    DesignsModule,
    ProductionModule,
    FactoryErpModule,
    LogisticsModule,
    TimelineModule,
    ClaimsModule,
    ConversationsModule,
    LedgerModule,
    ReceivablesModule,
    PayablesModule,
    PayoutsModule,
    BankingModule,
    TaxModule,
    FixedAssetsModule,
    FinancialReportsModule,
    CloseModule,
    AuditSupportModule,
    AnalyticsModule,
    ReportsModule,
    OpsModule,
    HealthModule,
    SurfacesModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: EtagInterceptor },
    { provide: APP_INTERCEPTOR, useClass: DeprecationInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
