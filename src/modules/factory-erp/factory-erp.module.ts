import { Global, Module } from '@nestjs/common';

import { ErpAlertsService } from './erp-alerts.service';
import { ErpCrmService } from './erp-crm.service';
import { ErpDocsService } from './erp-docs.service';
import { ErpFilesService } from './erp-files.service';
import { ErpInsightService } from './erp-insight.service';
import { ErpMaintenanceService } from './erp-maintenance.service';
import { ErpMasterService } from './erp-master.service';
import { ErpPayablesService } from './erp-payables.service';
import { ErpPdfService } from './erp-pdf.service';
import { ErpPeopleService } from './erp-people.service';
import { ErpPricingService } from './erp-pricing.service';
import { ErpProductionService } from './erp-production.service';
import { ErpPurchasingService } from './erp-purchasing.service';
import { ErpQualityService } from './erp-quality.service';
import { ErpQuotationsService } from './erp-quotations.service';
import { ErpReceivablesService } from './erp-receivables.service';
import { ErpRequestsService } from './erp-requests.service';
import { ErpSalesOrdersService } from './erp-sales-orders.service';
import { ErpScheduleService } from './erp-schedule.service';
import { ErpSourcingService } from './erp-sourcing.service';
import { ErpStockService } from './erp-stock.service';
import { ErpTaxService } from './erp-tax.service';
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
  ErpFilesService,
  ErpPdfService,
  ErpCrmService,
  ErpQuotationsService,
  ErpSalesOrdersService,
  ErpReceivablesService,
  ErpTaxService,
  ErpQualityService,
  ErpInsightService,
  ErpPeopleService,
];

/** Packio Factory ERP (D-316 – D-332): E1 trading partners, inventory, purchasing; E1.1
 * supplier prices; E2 purchase requests, payables, recipes, production orders and MRP; E2.1 sourcing
 * (breaks, alerts, RFQs, inspection, landed cost, approved suppliers); E3 schedule, kiosk, maintenance and documents; E4 sales, CRM, receivables and tax documents; E5 quality, insight and people. */
@Global()
@Module({ providers: SERVICES, exports: SERVICES })
export class FactoryErpModule {}
