import { PartnerMeController } from '@modules/auth/controllers/me.controllers';
import { Module } from '@nestjs/common';

/** `/v1/partner/*` — each deliverable adds the controllers it owns. */
@Module({
  controllers: [PartnerMeController],
})
export class PartnerApiModule {}
