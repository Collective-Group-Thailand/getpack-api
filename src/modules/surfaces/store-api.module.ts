import { StoreMeController } from '@modules/auth/controllers/me.controllers';
import { Module } from '@nestjs/common';

/** `/v1/store/*` — each deliverable adds the controllers it owns. */
@Module({
  controllers: [StoreMeController],
})
export class StoreApiModule {}
