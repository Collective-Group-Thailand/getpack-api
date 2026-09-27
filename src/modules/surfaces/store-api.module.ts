import { ARTWORK_STORE_CONTROLLERS } from '@modules/artwork/artwork.registry';
import { StoreMeController } from '@modules/auth/controllers/me.controllers';
import { CARTS_STORE_CONTROLLERS } from '@modules/carts/carts.registry';
import { StoreCatalogController } from '@modules/catalog/store/store-catalog.controller';
import { CHECKOUT_STORE_CONTROLLERS } from '@modules/checkout/checkout.registry';
import { COMPANIES_STORE_CONTROLLERS } from '@modules/companies/companies.registry';
import { CUSTOMERS_STORE_CONTROLLERS } from '@modules/customers/customers.registry';
import { DESIGN_SERVICES_STORE_CONTROLLERS } from '@modules/design-services/design-services.registry';
import { DESIGNS_STORE_CONTROLLERS } from '@modules/designs/designs.registry';
import { LOYALTY_STORE_CONTROLLERS } from '@modules/loyalty/loyalty.registry';
import { ORDERS_STORE_CONTROLLERS } from '@modules/orders/orders.registry';
import { StoreQuotePathController } from '@modules/partners/quote-path/quote-path.controller';
import { PAYMENT_SCHEDULES_STORE_CONTROLLERS } from '@modules/payment-schedules/payment-schedules.registry';
import { PAYMENTS_STORE_CONTROLLERS } from '@modules/payments/payments.registry';
import { PRICING_STORE_CONTROLLERS } from '@modules/pricing/pricing.registry';
import { PROMOTIONS_STORE_CONTROLLERS } from '@modules/promotions/promotions.registry';
import { QUOTES_STORE_CONTROLLERS } from '@modules/quotes/quotes.registry';
import { Module } from '@nestjs/common';
import { StoreFilesController } from '@platform/files/files.controllers';
import {
  StoreInboxController,
  StoreMyNotificationSettingsController,
} from '@platform/notifications/my-notifications.controller';
import { StoreRealtimeController, StoreWebPushController } from '@platform/realtime/realtime.controllers';
import { RealtimeModule } from '@platform/realtime/realtime.module';

/** `/v1/store/*` — each deliverable adds the controllers it owns. */
@Module({
  imports: [RealtimeModule],
  controllers: [
    StoreFilesController,

    StoreRealtimeController,
    StoreWebPushController,
    StoreMeController,
    StoreMyNotificationSettingsController,
    StoreInboxController,

    StoreCatalogController,
    StoreQuotePathController,
    ...PRICING_STORE_CONTROLLERS,
    ...QUOTES_STORE_CONTROLLERS,
    ...CUSTOMERS_STORE_CONTROLLERS,
    ...CARTS_STORE_CONTROLLERS,
    ...CHECKOUT_STORE_CONTROLLERS,
    ...ORDERS_STORE_CONTROLLERS,
    ...PAYMENT_SCHEDULES_STORE_CONTROLLERS,
    ...PROMOTIONS_STORE_CONTROLLERS,
    ...LOYALTY_STORE_CONTROLLERS,
    ...COMPANIES_STORE_CONTROLLERS,
    ...PAYMENTS_STORE_CONTROLLERS,
    ...ARTWORK_STORE_CONTROLLERS,
    ...DESIGN_SERVICES_STORE_CONTROLLERS,
    ...DESIGNS_STORE_CONTROLLERS,
  ],
})
export class StoreApiModule {}
