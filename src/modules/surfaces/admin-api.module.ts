import { ARTWORK_ADMIN_CONTROLLERS } from '@modules/artwork/artwork.registry';
import { AdminMeController } from '@modules/auth/controllers/me.controllers';
import { CARTS_ADMIN_CONTROLLERS } from '@modules/carts/carts.registry';
import { CATALOG_ADMIN_CONTROLLERS } from '@modules/catalog/catalog.registry';
import { CHECKOUT_ADMIN_CONTROLLERS } from '@modules/checkout/checkout.registry';
import { COMPANIES_ADMIN_CONTROLLERS } from '@modules/companies/companies.registry';
import { CUSTOMERS_ADMIN_CONTROLLERS } from '@modules/customers/customers.registry';
import { DISCOUNT_MEMOS_ADMIN_CONTROLLERS } from '@modules/discount-memos/discount-memos.registry';
import { RolesAdminController, UsersAdminController } from '@modules/iam/admin/users-admin.controller';
import { UsersAdminService } from '@modules/iam/admin/users-admin.service';
import { LOYALTY_ADMIN_CONTROLLERS } from '@modules/loyalty/loyalty.registry';
import { ORDERS_ADMIN_CONTROLLERS } from '@modules/orders/orders.registry';
import { FactoryOwnersService } from '@modules/partners/factories/factory-owners.service';
import { PARTNERS_ADMIN_CONTROLLERS } from '@modules/partners/partners.registry';
import { PAYMENT_SCHEDULES_ADMIN_CONTROLLERS } from '@modules/payment-schedules/payment-schedules.registry';
import { PAYMENTS_ADMIN_CONTROLLERS } from '@modules/payments/payments.registry';
import { PRICING_ADMIN_CONTROLLERS } from '@modules/pricing/pricing.registry';
import { PROMOTIONS_ADMIN_CONTROLLERS } from '@modules/promotions/promotions.registry';
import { QUOTES_ADMIN_CONTROLLERS } from '@modules/quotes/quotes.registry';
import { SHIPPING_ADMIN_CONTROLLERS } from '@modules/shipping/shipping.registry';
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
import { DocumentSeriesController } from '@platform/numbering/document-series.controller';
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
    DocumentSeriesController,

    ...CATALOG_ADMIN_CONTROLLERS,
    ...PARTNERS_ADMIN_CONTROLLERS,
    ...PRICING_ADMIN_CONTROLLERS,
    ...SHIPPING_ADMIN_CONTROLLERS,
    ...QUOTES_ADMIN_CONTROLLERS,
    ...CUSTOMERS_ADMIN_CONTROLLERS,
    ...CARTS_ADMIN_CONTROLLERS,
    ...CHECKOUT_ADMIN_CONTROLLERS,
    ...ORDERS_ADMIN_CONTROLLERS,
    ...PAYMENT_SCHEDULES_ADMIN_CONTROLLERS,
    ...PROMOTIONS_ADMIN_CONTROLLERS,
    ...LOYALTY_ADMIN_CONTROLLERS,
    ...COMPANIES_ADMIN_CONTROLLERS,
    ...DISCOUNT_MEMOS_ADMIN_CONTROLLERS,
    ...PAYMENTS_ADMIN_CONTROLLERS,
    ...ARTWORK_ADMIN_CONTROLLERS,
  ],
})
export class AdminApiModule {}
