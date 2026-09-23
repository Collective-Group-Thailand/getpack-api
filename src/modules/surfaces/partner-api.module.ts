import { PartnerMeController } from '@modules/auth/controllers/me.controllers';
import { Module } from '@nestjs/common';
import { PartnerInboxController } from '@platform/notifications/my-notifications.controller';
import { PartnerRealtimeController, PartnerWebPushController } from '@platform/realtime/realtime.controllers';
import { RealtimeModule } from '@platform/realtime/realtime.module';

/** `/v1/partner/*` — each deliverable adds the controllers it owns. */
@Module({
  imports: [RealtimeModule],
  controllers: [
    PartnerRealtimeController,
    PartnerWebPushController,
    PartnerMeController,
    PartnerInboxController,
  ],
})
export class PartnerApiModule {}
