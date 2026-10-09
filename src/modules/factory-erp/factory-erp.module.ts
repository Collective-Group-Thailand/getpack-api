import { Global, Module } from '@nestjs/common';

import { ErpMasterService } from './erp-master.service';
import { ErpPurchasingService } from './erp-purchasing.service';
import { ErpStockService } from './erp-stock.service';
import { ErpWorkspace } from './erp-workspace.service';

const SERVICES = [ErpWorkspace, ErpStockService, ErpMasterService, ErpPurchasingService];

/** Packio Factory ERP (D-316 – D-332): phase E1 — trading partners, inventory, purchasing. */
@Global()
@Module({ providers: SERVICES, exports: SERVICES })
export class FactoryErpModule {}
