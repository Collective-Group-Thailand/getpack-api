import { ADVISORY_STORE_CONTROLLERS } from '@modules/advisory/advisory.registry';
import { AGENTS_STORE_CONTROLLERS } from '@modules/agents/agents.registry';
import { ANALYTICS_STORE_CONTROLLERS } from '@modules/analytics/analytics.registry';
import { ARTWORK_STORE_CONTROLLERS } from '@modules/artwork/artwork.registry';
import { StoreAssistantController } from '@modules/assistant/assistant.controller';
import { StoreMeController } from '@modules/auth/controllers/me.controllers';
import { B2B_STORE_CONTROLLERS } from '@modules/b2b/b2b.registry';
import { CALL_OFFS_STORE_CONTROLLERS } from '@modules/call-offs/call-offs.registry';
import { CARTS_STORE_CONTROLLERS } from '@modules/carts/carts.registry';
import { StoreHomeContentController } from '@modules/catalog/store/home-content';
import { StorePublicConfigController } from '@modules/catalog/store/public-config';
import { StoreStatusLabelsController } from '@modules/catalog/store/status-labels.controller';
import { StoreCatalogController } from '@modules/catalog/store/store-catalog.controller';
import {
  StoreFeaturedServicesController,
  StoreSitemapController,
  StoreSupportChannelsController,
} from '@modules/catalog/store/store-site.controller';
import { CHECKOUT_STORE_CONTROLLERS } from '@modules/checkout/checkout.registry';
import { CLAIMS_STORE_CONTROLLERS } from '@modules/claims/claims.registry';
import { COMPANIES_STORE_CONTROLLERS } from '@modules/companies/companies.registry';
import { CONVERSATIONS_STORE_CONTROLLERS } from '@modules/conversations/conversations.registry';
import { CUSTOMERS_STORE_CONTROLLERS } from '@modules/customers/customers.registry';
import { DESIGN_SERVICES_STORE_CONTROLLERS } from '@modules/design-services/design-services.registry';
import { DESIGNS_STORE_CONTROLLERS } from '@modules/designs/designs.registry';
import { FACTORY_ERP_STORE_CONTROLLERS } from '@modules/factory-erp/factory-erp.registry';
import { LAUNCHPAD_STORE_CONTROLLERS } from '@modules/launchpad/launchpad.registry';
import { LOGISTICS_STORE_CONTROLLERS } from '@modules/logistics/logistics.registry';
import { LOYALTY_STORE_CONTROLLERS } from '@modules/loyalty/loyalty.registry';
import { OPS_STORE_CONTROLLERS } from '@modules/ops/ops.registry';
import { ORDERS_STORE_CONTROLLERS } from '@modules/orders/orders.registry';
import { PAYMENT_SCHEDULES_STORE_CONTROLLERS } from '@modules/payment-schedules/payment-schedules.registry';
import { PAYMENTS_STORE_CONTROLLERS } from '@modules/payments/payments.registry';
import { PRICING_STORE_CONTROLLERS } from '@modules/pricing/pricing.registry';
import { HeroPresetsService } from '@modules/pricing/quotes/hero-presets.service';
import { QuoteBatchService } from '@modules/pricing/quotes/quote-batch.service';
import { StoreQuotePathController } from '@modules/pricing/quotes/store-quote-path.controller';
import { PROMOTIONS_STORE_CONTROLLERS } from '@modules/promotions/promotions.registry';
import { QUOTES_STORE_CONTROLLERS } from '@modules/quotes/quotes.registry';
import { RECEIVABLES_STORE_CONTROLLERS } from '@modules/receivables/receivables.registry';
import { REORDERS_STORE_CONTROLLERS } from '@modules/reorders/reorders.registry';
import { SAMPLES_STORE_CONTROLLERS } from '@modules/samples/samples.registry';
import { STUDIO_STORE_CONTROLLERS } from '@modules/studio/studio.registry';
import { STYLES_STORE_CONTROLLERS } from '@modules/styles/styles.registry';
import { TIMELINE_STORE_CONTROLLERS } from '@modules/timeline/timeline.registry';
import { Module } from '@nestjs/common';
import { StoreFilesController } from '@platform/files/files.controllers';
import { StoreDeepLinksController } from '@platform/notifications/deep-links.controller';
import {
  StoreInboxController,
  StoreMyNotificationSettingsController,
} from '@platform/notifications/my-notifications.controller';
import { StoreRealtimeController, StoreWebPushController } from '@platform/realtime/realtime.controllers';
import { RealtimeModule } from '@platform/realtime/realtime.module';

/** `/v1/store/*` — each deliverable adds the controllers it owns. */
@Module({
  imports: [RealtimeModule],
  // API-only: the hero presets read the catalogue's store configurator, which the worker does not load (D-310).
  // HTTP-only: QuoteBatchService needs I18nService, which the worker process does not load.
  providers: [HeroPresetsService, QuoteBatchService],
  controllers: [
    ...OPS_STORE_CONTROLLERS,
    StoreFilesController,

    StoreRealtimeController,
    StoreWebPushController,
    StoreMeController,
    StoreMyNotificationSettingsController,
    StoreInboxController,
    StoreDeepLinksController,

    StoreCatalogController,
    StoreSitemapController,
    StoreFeaturedServicesController,
    StoreSupportChannelsController,
    StoreStatusLabelsController,
    StorePublicConfigController,
    StoreHomeContentController,
    StoreQuotePathController,
    ...PRICING_STORE_CONTROLLERS,
    ...QUOTES_STORE_CONTROLLERS,
    ...ADVISORY_STORE_CONTROLLERS,
    ...SAMPLES_STORE_CONTROLLERS,
    ...STYLES_STORE_CONTROLLERS,
    ...STUDIO_STORE_CONTROLLERS,
    ...CUSTOMERS_STORE_CONTROLLERS,
    ...CARTS_STORE_CONTROLLERS,
    ...CHECKOUT_STORE_CONTROLLERS,
    ...ORDERS_STORE_CONTROLLERS,
    ...CALL_OFFS_STORE_CONTROLLERS,
    ...B2B_STORE_CONTROLLERS,
    ...REORDERS_STORE_CONTROLLERS,
    ...LAUNCHPAD_STORE_CONTROLLERS,
    StoreAssistantController,
    ...LOGISTICS_STORE_CONTROLLERS,
    ...CLAIMS_STORE_CONTROLLERS,
    ...CONVERSATIONS_STORE_CONTROLLERS,
    ...TIMELINE_STORE_CONTROLLERS,
    ...PAYMENT_SCHEDULES_STORE_CONTROLLERS,
    ...PROMOTIONS_STORE_CONTROLLERS,
    ...LOYALTY_STORE_CONTROLLERS,
    ...AGENTS_STORE_CONTROLLERS,
    ...COMPANIES_STORE_CONTROLLERS,
    ...PAYMENTS_STORE_CONTROLLERS,
    ...RECEIVABLES_STORE_CONTROLLERS,
    ...ARTWORK_STORE_CONTROLLERS,
    ...DESIGN_SERVICES_STORE_CONTROLLERS,
    ...DESIGNS_STORE_CONTROLLERS,
    ...ANALYTICS_STORE_CONTROLLERS,
    ...FACTORY_ERP_STORE_CONTROLLERS,
  ],
})
export class StoreApiModule {}
