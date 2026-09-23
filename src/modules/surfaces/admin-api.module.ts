import { AdminMeController } from '@modules/auth/controllers/me.controllers';
import { RolesAdminController, UsersAdminController } from '@modules/iam/admin/users-admin.controller';
import { UsersAdminService } from '@modules/iam/admin/users-admin.service';
import { Module } from '@nestjs/common';
import { ApprovalDelegationsController, ApprovalsController } from '@platform/approvals/approvals.controller';
import { OutboxAdminController } from '@platform/domain-events/outbox-admin.controller';

/** `/v1/admin/*` — each deliverable adds the controllers it owns. */
@Module({
  providers: [UsersAdminService],
  controllers: [
    AdminMeController,
    UsersAdminController,
    RolesAdminController,
    OutboxAdminController,
    ApprovalsController,
    ApprovalDelegationsController,
  ],
})
export class AdminApiModule {}
