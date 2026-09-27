import { buildLoggerParams } from '@common/logging/logger.options';
import { AppConfig } from '@config/app-config';
import { AppConfigModule } from '@config/app-config.module';
import { DatabaseModule } from '@database/database.module';
import { BULLMQ_REDIS, RedisModule } from '@database/redis.module';
import { IntegrationsModule } from '@integrations/integrations.module';
import { ArtworkModule } from '@modules/artwork/artwork.module';
import { CartsModule } from '@modules/carts/carts.module';
import { CheckoutModule } from '@modules/checkout/checkout.module';
import { CompaniesModule } from '@modules/companies/companies.module';
import { CustomersModule } from '@modules/customers/customers.module';
import { DesignServicesModule } from '@modules/design-services/design-services.module';
import { DiscountMemosModule } from '@modules/discount-memos/discount-memos.module';
import { IamModule } from '@modules/iam/iam.module';
import { LoyaltyModule } from '@modules/loyalty/loyalty.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { PartnersModule } from '@modules/partners/partners.module';
import { PaymentSchedulesModule } from '@modules/payment-schedules/payment-schedules.module';
import { PaymentsModule } from '@modules/payments/payments.module';
import { PricingModule } from '@modules/pricing/pricing.module';
import { PromotionsModule } from '@modules/promotions/promotions.module';
import { QuotesModule } from '@modules/quotes/quotes.module';
import { RfqModule } from '@modules/rfq/rfq.module';
import { ShippingModule } from '@modules/shipping/shipping.module';
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
      useFactory: (connection: Redis) => ({ prefix: 'packio', connection }),
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
    DomainEventsWorkerModule,
  ],
  providers: [WorkerLifecycle],
})
export class WorkerModule {}
