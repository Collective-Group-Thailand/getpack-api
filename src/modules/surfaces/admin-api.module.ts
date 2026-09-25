import { AdminMeController } from '@modules/auth/controllers/me.controllers';
import { CATALOG_ADMIN_CONTROLLERS } from '@modules/catalog/catalog.registry';
import { RolesAdminController, UsersAdminController } from '@modules/iam/admin/users-admin.controller';
import { UsersAdminService } from '@modules/iam/admin/users-admin.service';
import { FactoryOwnersService } from '@modules/partners/factories/factory-owners.service';
import { PARTNERS_ADMIN_CONTROLLERS } from '@modules/partners/partners.registry';
import { Module } from '@nestjs/common';
import { ApprovalDelegationsController, ApprovalsController } from '@platform/approvals/approvals.controller';
import { AuditLogsController } from '@platform/audit/audit.controller';
import { AuditQueryService } from '@platform/audit/audit-query.service';
import { OutboxAdminController } from '@platform/domain-events/outbox-admin.controller';
import { FeatureFlagsController } from '@platform/feature-flags/feature-flags.controller';
import { AdminFilesController } from '@platform/files/files.controllers';
import { AdminInboxController } from '@platform/notifications/my-notifications.controller';
import {
  ConsentPurposesController,
  NotificationRoutesController,
  NotificationTemplatesController,
} from '@platform/notifications/notifications-admin.controller';
import { AdminRealtimeController, AdminWebPushController } from '@platform/realtime/realtime.controllers';
import { RealtimeModule } from '@platform/realtime/realtime.module';
import { SettingsController } from '@platform/settings/settings.controller';
import { SettingsAdminModule } from '@platform/settings/settings-admin.module';

/** `/v1/admin/*` — each deliverable adds the controllers it owns. */
@Module({
  imports: [RealtimeModule, SettingsAdminModule],
  providers: [UsersAdminService, AuditQueryService, FactoryOwnersService],
  controllers: [
    AdminFilesController,

    AdminRealtimeController,
    AdminWebPushController,

    AdminMeController,
    UsersAdminController,
    RolesAdminController,
    OutboxAdminController,
    ApprovalsController,
    ApprovalDelegationsController,
    SettingsController,
    FeatureFlagsController,
    NotificationTemplatesController,
    NotificationRoutesController,
    ConsentPurposesController,
    AdminInboxController,
    AuditLogsController,

    ...CATALOG_ADMIN_CONTROLLERS,
    ...PARTNERS_ADMIN_CONTROLLERS,
  ],
})
export class AdminApiModule {}
