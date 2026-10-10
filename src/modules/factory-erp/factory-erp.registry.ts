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

/** `/v1/partner/factories/{factoryId}/erp/*` (E1, E1.1, E2, E2.1, E3). */
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
];
