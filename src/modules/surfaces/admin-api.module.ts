import { AdminMeController } from '@modules/auth/controllers/me.controllers';
import { RolesAdminController, UsersAdminController } from '@modules/iam/admin/users-admin.controller';
import { Module } from '@nestjs/common';
import { OutboxAdminController } from '@platform/domain-events/outbox-admin.controller';

/** `/v1/admin/*` — each deliverable adds the controllers it owns. */
@Module({
  controllers: [AdminMeController, UsersAdminController, RolesAdminController, OutboxAdminController],
})
export class AdminApiModule {}
