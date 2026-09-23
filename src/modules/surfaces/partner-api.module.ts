import { PartnerMeController } from '@modules/auth/controllers/me.controllers';
import { Module } from '@nestjs/common';
import { PartnerInboxController } from '@platform/notifications/my-notifications.controller';

/** `/v1/partner/*` — each deliverable adds the controllers it owns. */
@Module({
  controllers: [PartnerMeController, PartnerInboxController],
})
export class PartnerApiModule {}
