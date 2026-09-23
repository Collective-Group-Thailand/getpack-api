import { AdminMeController } from '@modules/auth/controllers/me.controllers';
import { Module } from '@nestjs/common';

/** `/v1/admin/*` — each deliverable adds the controllers it owns. */
@Module({
  controllers: [AdminMeController],
})
export class AdminApiModule {}
