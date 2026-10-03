import { ADVISORY_PARTNER_CONTROLLERS } from '@modules/advisory/advisory.registry';
import { PartnerMeController } from '@modules/auth/controllers/me.controllers';
import { CALL_OFFS_PARTNER_CONTROLLERS } from '@modules/call-offs/call-offs.registry';
import { CLAIMS_PARTNER_CONTROLLERS } from '@modules/claims/claims.registry';
import { LOGISTICS_PARTNER_CONTROLLERS } from '@modules/logistics/logistics.registry';
import { OPS_PARTNER_CONTROLLERS } from '@modules/ops/ops.registry';
import { ORDERS_PARTNER_CONTROLLERS } from '@modules/orders/orders.registry';
import { PARTNERS_PARTNER_CONTROLLERS } from '@modules/partners/partners.registry';
import { PAYABLES_PARTNER_CONTROLLERS } from '@modules/payables/payables.registry';
import { PAYOUTS_PARTNER_CONTROLLERS } from '@modules/payouts/payouts.registry';
import { PRICING_PARTNER_CONTROLLERS } from '@modules/pricing/pricing.registry';
import { PRODUCTION_PARTNER_CONTROLLERS } from '@modules/production/production.registry';
import { QUOTES_PARTNER_CONTROLLERS } from '@modules/quotes/quotes.registry';
import { SAMPLES_PARTNER_CONTROLLERS } from '@modules/samples/samples.registry';
import { SHIPPING_PARTNER_CONTROLLERS } from '@modules/shipping/shipping.registry';
import { STYLES_PARTNER_CONTROLLERS } from '@modules/styles/styles.registry';
import { TOOLING_PARTNER_CONTROLLERS } from '@modules/tooling/tooling.registry';
import { Module } from '@nestjs/common';
import { PartnerFilesController } from '@platform/files/files.controllers';
import {
  PartnerInboxController,
  PartnerMyNotificationSettingsController,
} from '@platform/notifications/my-notifications.controller';
import { PartnerRealtimeController, PartnerWebPushController } from '@platform/realtime/realtime.controllers';
import { RealtimeModule } from '@platform/realtime/realtime.module';

/** `/v1/partner/*` — each deliverable adds the controllers it owns. */
@Module({
  imports: [RealtimeModule],
  controllers: [
    ...OPS_PARTNER_CONTROLLERS,
    PartnerFilesController,

    PartnerRealtimeController,
    PartnerWebPushController,
    PartnerMeController,
    PartnerInboxController,
    PartnerMyNotificationSettingsController,

    ...PARTNERS_PARTNER_CONTROLLERS,
    ...PAYABLES_PARTNER_CONTROLLERS,
    ...PAYOUTS_PARTNER_CONTROLLERS,
    ...PRICING_PARTNER_CONTROLLERS,
    ...SHIPPING_PARTNER_CONTROLLERS,
    ...QUOTES_PARTNER_CONTROLLERS,
    ...ADVISORY_PARTNER_CONTROLLERS,
    ...SAMPLES_PARTNER_CONTROLLERS,
    ...STYLES_PARTNER_CONTROLLERS,
    ...ORDERS_PARTNER_CONTROLLERS,
    ...CALL_OFFS_PARTNER_CONTROLLERS,
    ...TOOLING_PARTNER_CONTROLLERS,
    ...PRODUCTION_PARTNER_CONTROLLERS,
    ...LOGISTICS_PARTNER_CONTROLLERS,
    ...CLAIMS_PARTNER_CONTROLLERS,
  ],
})
export class PartnerApiModule {}
