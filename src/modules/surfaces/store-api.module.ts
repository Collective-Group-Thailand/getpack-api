import { StoreMeController } from '@modules/auth/controllers/me.controllers';
import { CARTS_STORE_CONTROLLERS } from '@modules/carts/carts.registry';
import { StoreCatalogController } from '@modules/catalog/store/store-catalog.controller';
import { CUSTOMERS_STORE_CONTROLLERS } from '@modules/customers/customers.registry';
import { StoreQuotePathController } from '@modules/partners/quote-path/quote-path.controller';
import { PRICING_STORE_CONTROLLERS } from '@modules/pricing/pricing.registry';
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
  ],
})
export class StoreApiModule {}
