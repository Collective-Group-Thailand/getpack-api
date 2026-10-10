import { Global, Module } from '@nestjs/common';

import { ErpAlertsService } from './erp-alerts.service';
import { ErpDocsService } from './erp-docs.service';
import { ErpMaintenanceService } from './erp-maintenance.service';
import { ErpMasterService } from './erp-master.service';
import { ErpPayablesService } from './erp-payables.service';
import { ErpPricingService } from './erp-pricing.service';
import { ErpProductionService } from './erp-production.service';
import { ErpPurchasingService } from './erp-purchasing.service';
import { ErpRequestsService } from './erp-requests.service';
import { ErpScheduleService } from './erp-schedule.service';
import { ErpSourcingService } from './erp-sourcing.service';
import { ErpStockService } from './erp-stock.service';
import { ErpWorkspace } from './erp-workspace.service';

const SERVICES = [
  ErpWorkspace,
  ErpAlertsService,
  ErpStockService,
  ErpPricingService,
  ErpMasterService,
  ErpPurchasingService,
  ErpRequestsService,
  ErpPayablesService,
  ErpProductionService,
  ErpSourcingService,
  ErpMaintenanceService,
  ErpScheduleService,
  ErpDocsService,
];

/** Packio Factory ERP (D-316 – D-332): E1 trading partners, inventory, purchasing; E1.1
 * supplier prices; E2 purchase requests, payables, recipes, production orders and MRP; E2.1 sourcing
 * (breaks, alerts, RFQs, inspection, landed cost, approved suppliers); E3 schedule, kiosk, maintenance and documents. */
@Global()
@Module({ providers: SERVICES, exports: SERVICES })
export class FactoryErpModule {}
