import { Global, Module } from '@nestjs/common';

import { ErpMasterService } from './erp-master.service';
import { ErpPayablesService } from './erp-payables.service';
import { ErpPricingService } from './erp-pricing.service';
import { ErpProductionService } from './erp-production.service';
import { ErpPurchasingService } from './erp-purchasing.service';
import { ErpRequestsService } from './erp-requests.service';
import { ErpStockService } from './erp-stock.service';
import { ErpWorkspace } from './erp-workspace.service';

const SERVICES = [
  ErpWorkspace,
  ErpStockService,
  ErpPricingService,
  ErpMasterService,
  ErpPurchasingService,
  ErpRequestsService,
  ErpPayablesService,
  ErpProductionService,
];

/** Packio Factory ERP (D-316 – D-332): E1 trading partners, inventory, purchasing; E1.1
 * supplier prices; E2 purchase requests, payables, recipes, production orders and MRP. */
@Global()
@Module({ providers: SERVICES, exports: SERVICES })
export class FactoryErpModule {}
