import { StoreMeController } from '@modules/auth/controllers/me.controllers';
import { Module } from '@nestjs/common';
import {
  StoreInboxController,
  StoreMyNotificationSettingsController,
} from '@platform/notifications/my-notifications.controller';

/** `/v1/store/*` — each deliverable adds the controllers it owns. */
@Module({
  controllers: [StoreMeController, StoreMyNotificationSettingsController, StoreInboxController],
})
export class StoreApiModule {}
