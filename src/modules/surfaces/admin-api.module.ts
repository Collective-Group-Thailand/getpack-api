import { AdminMeController } from '@modules/auth/controllers/me.controllers';
import { RolesAdminController, UsersAdminController } from '@modules/iam/admin/users-admin.controller';
import { UsersAdminService } from '@modules/iam/admin/users-admin.service';
import { Module } from '@nestjs/common';
import { ApprovalDelegationsController, ApprovalsController } from '@platform/approvals/approvals.controller';
import { OutboxAdminController } from '@platform/domain-events/outbox-admin.controller';
import { FeatureFlagsController } from '@platform/feature-flags/feature-flags.controller';
import { SettingsController } from '@platform/settings/settings.controller';
import { SettingsAdminModule } from '@platform/settings/settings-admin.module';

/** `/v1/admin/*` — each deliverable adds the controllers it owns. */
@Module({
  imports: [SettingsAdminModule],
  providers: [UsersAdminService],
  controllers: [
    AdminMeController,
    UsersAdminController,
    RolesAdminController,
    OutboxAdminController,
    ApprovalsController,
    ApprovalDelegationsController,
    SettingsController,
    FeatureFlagsController,
  ],
})
export class AdminApiModule {}
