import { PartnerMeController } from '@modules/auth/controllers/me.controllers';
import { CLAIMS_PARTNER_CONTROLLERS } from '@modules/claims/claims.registry';
import { LOGISTICS_PARTNER_CONTROLLERS } from '@modules/logistics/logistics.registry';
import { PARTNERS_PARTNER_CONTROLLERS } from '@modules/partners/partners.registry';
import { PRICING_PARTNER_CONTROLLERS } from '@modules/pricing/pricing.registry';
import { PRODUCTION_PARTNER_CONTROLLERS } from '@modules/production/production.registry';
import { QUOTES_PARTNER_CONTROLLERS } from '@modules/quotes/quotes.registry';
import { SHIPPING_PARTNER_CONTROLLERS } from '@modules/shipping/shipping.registry';
import { Module } from '@nestjs/common';
import { PartnerFilesController } from '@platform/files/files.controllers';
import { PartnerInboxController } from '@platform/notifications/my-notifications.controller';
import { PartnerRealtimeController, PartnerWebPushController } from '@platform/realtime/realtime.controllers';
import { RealtimeModule } from '@platform/realtime/realtime.module';

/** `/v1/partner/*` — each deliverable adds the controllers it owns. */
@Module({
  imports: [RealtimeModule],
  controllers: [
    PartnerFilesController,

    PartnerRealtimeController,
    PartnerWebPushController,
    PartnerMeController,
    PartnerInboxController,

    ...PARTNERS_PARTNER_CONTROLLERS,
    ...PRICING_PARTNER_CONTROLLERS,
    ...SHIPPING_PARTNER_CONTROLLERS,
    ...QUOTES_PARTNER_CONTROLLERS,
    ...PRODUCTION_PARTNER_CONTROLLERS,
    ...LOGISTICS_PARTNER_CONTROLLERS,
    ...CLAIMS_PARTNER_CONTROLLERS,
  ],
})
export class PartnerApiModule {}
