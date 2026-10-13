import { type Type } from '@nestjs/common';

import {
  PartnerErpGoodsReceiptsController,
  PartnerErpItemsController,
  PartnerErpPartnersController,
  PartnerErpPurchaseOrdersController,
  PartnerErpSettingsController,
  PartnerErpStockController,
  PartnerErpWarehousesController,
} from './erp.controllers';
import {
  PartnerErpItemSuppliersController,
  PartnerErpPlanningController,
  PartnerErpProductionOrdersController,
  PartnerErpPurchaseRequestsController,
  PartnerErpRecipesController,
  PartnerErpSupplierInvoicesController,
  PartnerErpSupplierPaymentsController,
} from './erp-e2.controllers';
import {
  PartnerErpAlertsController,
  PartnerErpDocumentsController,
  PartnerErpMachinesController,
  PartnerErpMaintenanceController,
  PartnerErpRfqsController,
  PartnerErpScheduleController,
  PartnerErpSourcingController,
} from './erp-e3.controllers';
import {
  PartnerErpCrmController,
  PartnerErpDeliveryNotesController,
  PartnerErpQuotationsController,
  PartnerErpReceivablesController,
  PartnerErpSalesInvoicesController,
  PartnerErpSalesOrdersController,
  PartnerErpTaxController,
  PublicQuotationLinksController,
} from './erp-e4.controllers';
import {
  AdminErpSupportController,
  PartnerErpInsightController,
  PartnerErpPeopleController,
  PartnerErpQualityController,
} from './erp-e5.controllers';

/** `/v1/partner/factories/{factoryId}/erp/*` (E1, E1.1, E2, E2.1, E3, E4, E5). */
export const FACTORY_ERP_PARTNER_CONTROLLERS: Type<unknown>[] = [
  PartnerErpSettingsController,
  PartnerErpPartnersController,
  PartnerErpWarehousesController,
  PartnerErpItemsController,
  PartnerErpStockController,
  PartnerErpPurchaseOrdersController,
  PartnerErpGoodsReceiptsController,
  PartnerErpItemSuppliersController,
  PartnerErpPurchaseRequestsController,
  PartnerErpSupplierInvoicesController,
  PartnerErpSupplierPaymentsController,
  PartnerErpRecipesController,
  PartnerErpProductionOrdersController,
  PartnerErpPlanningController,
  PartnerErpSourcingController,
  PartnerErpAlertsController,
  PartnerErpRfqsController,
  PartnerErpMachinesController,
  PartnerErpScheduleController,
  PartnerErpMaintenanceController,
  PartnerErpDocumentsController,
  PartnerErpCrmController,
  PartnerErpQuotationsController,
  PartnerErpSalesOrdersController,
  PartnerErpDeliveryNotesController,
  PartnerErpSalesInvoicesController,
  PartnerErpReceivablesController,
  PartnerErpTaxController,
  PartnerErpQualityController,
  PartnerErpInsightController,
  PartnerErpPeopleController,
];

/** `/v1/store/quote-links/{token}` — the customer's quotation link (D-360). */
export const FACTORY_ERP_STORE_CONTROLLERS: Type<unknown>[] = [PublicQuotationLinksController];

/** `/v1/admin/factories/{factoryId}/erp/*` — Packio support's read under the owner's grant (D-381). */
export const FACTORY_ERP_ADMIN_CONTROLLERS: Type<unknown>[] = [AdminErpSupportController];
