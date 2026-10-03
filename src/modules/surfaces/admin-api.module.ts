import { ADVISORY_ADMIN_CONTROLLERS } from '@modules/advisory/advisory.registry';
import { ANALYTICS_ADMIN_CONTROLLERS } from '@modules/analytics/analytics.registry';
import { ARTWORK_ADMIN_CONTROLLERS } from '@modules/artwork/artwork.registry';
import { AUDIT_SUPPORT_ADMIN_CONTROLLERS } from '@modules/audit-support/audit-support.registry';
import { AdminMeController } from '@modules/auth/controllers/me.controllers';
import { BANKING_ADMIN_CONTROLLERS } from '@modules/banking/banking.registry';
import { CARTS_ADMIN_CONTROLLERS } from '@modules/carts/carts.registry';
import { CATALOG_ADMIN_CONTROLLERS } from '@modules/catalog/catalog.registry';
import { CHECKOUT_ADMIN_CONTROLLERS } from '@modules/checkout/checkout.registry';
import { CLAIMS_ADMIN_CONTROLLERS } from '@modules/claims/claims.registry';
import { CLOSE_ADMIN_CONTROLLERS } from '@modules/close/close.registry';
import { COMPANIES_ADMIN_CONTROLLERS } from '@modules/companies/companies.registry';
import { CONVERSATIONS_ADMIN_CONTROLLERS } from '@modules/conversations/conversations.registry';
import { CUSTOMERS_ADMIN_CONTROLLERS } from '@modules/customers/customers.registry';
import { DESIGN_SERVICES_ADMIN_CONTROLLERS } from '@modules/design-services/design-services.registry';
import { DESIGNS_ADMIN_CONTROLLERS } from '@modules/designs/designs.registry';
import { DISCOUNT_MEMOS_ADMIN_CONTROLLERS } from '@modules/discount-memos/discount-memos.registry';
import { FINANCIAL_REPORTS_ADMIN_CONTROLLERS } from '@modules/financial-reports/financial-reports.registry';
import { FIXED_ASSETS_ADMIN_CONTROLLERS } from '@modules/fixed-assets/fixed-assets.registry';
import { SodRulesController, StaffDirectoryController } from '@modules/iam/admin/directory.controller';
import { SavedViewsController } from '@modules/iam/admin/saved-views.controller';
import { AdminSearchController } from '@modules/iam/admin/search.controller';
import { RolesAdminController, UsersAdminController } from '@modules/iam/admin/users-admin.controller';
import { UsersAdminService } from '@modules/iam/admin/users-admin.service';
import { LEDGER_ADMIN_CONTROLLERS } from '@modules/ledger/ledger.registry';
import { LOGISTICS_ADMIN_CONTROLLERS } from '@modules/logistics/logistics.registry';
import { LOYALTY_ADMIN_CONTROLLERS } from '@modules/loyalty/loyalty.registry';
import { OPS_ADMIN_CONTROLLERS } from '@modules/ops/ops.registry';
import { ORDERS_ADMIN_CONTROLLERS } from '@modules/orders/orders.registry';
import { FactoryOwnersService } from '@modules/partners/factories/factory-owners.service';
import { PARTNERS_ADMIN_CONTROLLERS } from '@modules/partners/partners.registry';
import { PAYABLES_ADMIN_CONTROLLERS } from '@modules/payables/payables.registry';
import { PAYMENT_SCHEDULES_ADMIN_CONTROLLERS } from '@modules/payment-schedules/payment-schedules.registry';
import { PAYMENTS_ADMIN_CONTROLLERS } from '@modules/payments/payments.registry';
import { PAYOUTS_ADMIN_CONTROLLERS } from '@modules/payouts/payouts.registry';
import { PRICING_ADMIN_CONTROLLERS } from '@modules/pricing/pricing.registry';
import { PRODUCTION_ADMIN_CONTROLLERS } from '@modules/production/production.registry';
import { PROMOTIONS_ADMIN_CONTROLLERS } from '@modules/promotions/promotions.registry';
import { QUOTES_ADMIN_CONTROLLERS } from '@modules/quotes/quotes.registry';
import { RECEIVABLES_ADMIN_CONTROLLERS } from '@modules/receivables/receivables.registry';
import { REORDERS_ADMIN_CONTROLLERS } from '@modules/reorders/reorders.registry';
import { REPORTS_ADMIN_CONTROLLERS } from '@modules/reports/reports.registry';
import { SAMPLES_ADMIN_CONTROLLERS } from '@modules/samples/samples.registry';
import { SHIPPING_ADMIN_CONTROLLERS } from '@modules/shipping/shipping.registry';
import { STUDIO_ADMIN_CONTROLLERS } from '@modules/studio/studio.registry';
import { STYLES_ADMIN_CONTROLLERS } from '@modules/styles/styles.registry';
import { TAX_ADMIN_CONTROLLERS } from '@modules/tax/tax.registry';
import { TIMELINE_ADMIN_CONTROLLERS } from '@modules/timeline/timeline.registry';
import { TOOLING_ADMIN_CONTROLLERS } from '@modules/tooling/tooling.registry';
import { Module } from '@nestjs/common';
import { AdminApprovalPoliciesController } from '@platform/approvals/approval-policies.controller';
import { ApprovalDelegationsController, ApprovalsController } from '@platform/approvals/approvals.controller';
import { AuditLogsController } from '@platform/audit/audit.controller';
import { AuditQueryService } from '@platform/audit/audit-query.service';
import { AdminCalendarController } from '@platform/calendar/calendar-admin.controller';
import { OutboxAdminController } from '@platform/domain-events/outbox-admin.controller';
import { FeatureFlagsController } from '@platform/feature-flags/feature-flags.controller';
import { AdminFilesController } from '@platform/files/files.controllers';
import { AdminInboxController } from '@platform/notifications/my-notifications.controller';
import {
  AdminCustomerConsentsController,
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
    StaffDirectoryController,
    SodRulesController,
    SavedViewsController,
    AdminCalendarController,
    AdminSearchController,
    OutboxAdminController,
    ApprovalsController,
    ApprovalDelegationsController,
    AdminApprovalPoliciesController,
    SettingsController,
    FeatureFlagsController,
    NotificationTemplatesController,
    NotificationRoutesController,
    ConsentPurposesController,
    AdminCustomerConsentsController,
    AdminInboxController,
    AuditLogsController,
    DocumentSeriesController,

    ...CATALOG_ADMIN_CONTROLLERS,
    ...PARTNERS_ADMIN_CONTROLLERS,
    ...PRICING_ADMIN_CONTROLLERS,
    ...SHIPPING_ADMIN_CONTROLLERS,
    ...QUOTES_ADMIN_CONTROLLERS,
    ...ADVISORY_ADMIN_CONTROLLERS,
    ...SAMPLES_ADMIN_CONTROLLERS,
    ...STYLES_ADMIN_CONTROLLERS,
    ...STUDIO_ADMIN_CONTROLLERS,
    ...CUSTOMERS_ADMIN_CONTROLLERS,
    ...CARTS_ADMIN_CONTROLLERS,
    ...CHECKOUT_ADMIN_CONTROLLERS,
    ...ORDERS_ADMIN_CONTROLLERS,
    ...REORDERS_ADMIN_CONTROLLERS,
    ...TOOLING_ADMIN_CONTROLLERS,
    ...PAYMENT_SCHEDULES_ADMIN_CONTROLLERS,
    ...PROMOTIONS_ADMIN_CONTROLLERS,
    ...LOYALTY_ADMIN_CONTROLLERS,
    ...COMPANIES_ADMIN_CONTROLLERS,
    ...DISCOUNT_MEMOS_ADMIN_CONTROLLERS,
    ...PAYMENTS_ADMIN_CONTROLLERS,
    ...ARTWORK_ADMIN_CONTROLLERS,
    ...DESIGN_SERVICES_ADMIN_CONTROLLERS,
    ...DESIGNS_ADMIN_CONTROLLERS,
    ...PRODUCTION_ADMIN_CONTROLLERS,
    ...LOGISTICS_ADMIN_CONTROLLERS,
    ...CLAIMS_ADMIN_CONTROLLERS,
    ...CONVERSATIONS_ADMIN_CONTROLLERS,
    ...TIMELINE_ADMIN_CONTROLLERS,
    ...LEDGER_ADMIN_CONTROLLERS,
    ...RECEIVABLES_ADMIN_CONTROLLERS,
    ...PAYABLES_ADMIN_CONTROLLERS,
    ...PAYOUTS_ADMIN_CONTROLLERS,
    ...BANKING_ADMIN_CONTROLLERS,
    ...TAX_ADMIN_CONTROLLERS,
    ...FIXED_ASSETS_ADMIN_CONTROLLERS,
    ...FINANCIAL_REPORTS_ADMIN_CONTROLLERS,
    ...CLOSE_ADMIN_CONTROLLERS,
    ...AUDIT_SUPPORT_ADMIN_CONTROLLERS,
    ...ANALYTICS_ADMIN_CONTROLLERS,
    ...REPORTS_ADMIN_CONTROLLERS,
    ...OPS_ADMIN_CONTROLLERS,
  ],
})
export class AdminApiModule {}
