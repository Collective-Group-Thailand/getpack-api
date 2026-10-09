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

/** `/v1/partner/factories/{factoryId}/erp/*` (E1). */
export const FACTORY_ERP_PARTNER_CONTROLLERS: Type<unknown>[] = [
  PartnerErpSettingsController,
  PartnerErpPartnersController,
  PartnerErpWarehousesController,
  PartnerErpItemsController,
  PartnerErpStockController,
  PartnerErpPurchaseOrdersController,
  PartnerErpGoodsReceiptsController,
];
