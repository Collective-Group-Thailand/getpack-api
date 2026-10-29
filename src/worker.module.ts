import { buildLoggerParams } from '@common/logging/logger.options';
import { AppConfig } from '@config/app-config';
import { AppConfigModule } from '@config/app-config.module';
import { DatabaseModule } from '@database/database.module';
import { BULLMQ_REDIS, RedisModule } from '@database/redis.module';
import { IntegrationsModule } from '@integrations/integrations.module';
import { AgentsModule } from '@modules/agents/agents.module';
import { AnalyticsModule } from '@modules/analytics/analytics.module';
import { ArtworkModule } from '@modules/artwork/artwork.module';
import { AssistantModule } from '@modules/assistant/assistant.module';
import { AuditSupportModule } from '@modules/audit-support/audit-support.module';
import { B2bWorkerModule } from '@modules/b2b/b2b.module';
import { BankingModule } from '@modules/banking/banking.module';
import { CallOffsModule } from '@modules/call-offs/call-offs.module';
import { CartsModule } from '@modules/carts/carts.module';
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
import { DocumentsModule } from '@modules/documents/documents.module';
import { FactoryErpModule } from '@modules/factory-erp/factory-erp.module';
import { FinancialReportsModule } from '@modules/financial-reports/financial-reports.module';
import { FixedAssetsModule } from '@modules/fixed-assets/fixed-assets.module';
import { IamModule } from '@modules/iam/iam.module';
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
import { SamplesModule } from '@modules/samples/samples.module';
import { ShippingModule } from '@modules/shipping/shipping.module';
import { StudioModule } from '@modules/studio/studio.module';
import { StylesModule, StylesWorkerModule } from '@modules/styles/styles.module';
import { TaxModule } from '@modules/tax/tax.module';
import { TimelineModule } from '@modules/timeline/timeline.module';
import { ToolingModule } from '@modules/tooling/tooling.module';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ApprovalsModule } from '@platform/approvals/approvals.module';
import { DomainEventsWorkerModule } from '@platform/domain-events/domain-events-worker.module';
import { FilesModule } from '@platform/files/files.module';
import { NotificationsModule } from '@platform/notifications/notifications.module';
import { PlatformCoreModule } from '@platform/platform-core.module';
import { SettingsAdminModule } from '@platform/settings/settings-admin.module';
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
      useFactory: (connection: Redis) => ({ prefix: 'getpack', connection }),
    }),
    DatabaseModule,
    IntegrationsModule,
    PlatformCoreModule,
    IamModule,
    ApprovalsModule,
    NotificationsModule,
    FilesModule,
    SettingsAdminModule,
    PartnersModule,
    FactoryErpModule,
    PricingModule,
    ShippingModule,
    QuotesModule,
    SamplesModule,
    StylesModule,
    StylesWorkerModule,
    StudioModule,
    RfqModule,
    CustomersModule,
    CartsModule,
    CheckoutModule,
    OrdersModule,
    ToolingModule,
    ReordersModule,
    CallOffsModule,
    B2bWorkerModule,
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
    LogisticsModule,
    TimelineModule,
    ClaimsModule,
    ConversationsModule,
    StorefrontRevalidationModule,
    AssistantModule,
    LedgerModule,
    ReceivablesModule,
    DocumentsModule,
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
    DomainEventsWorkerModule,
  ],
  providers: [WorkerLifecycle],
})
export class WorkerModule {}
