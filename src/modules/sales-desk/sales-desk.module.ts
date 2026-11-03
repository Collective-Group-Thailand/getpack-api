import { Global, Module } from '@nestjs/common';

import { DiscountApprovalsService } from './discount-approvals.service';
import { DiscountedQuotesService, SalesQuoteDiscountCheckout } from './discounted-quotes.service';
import { SalesCsvService } from './sales-csv.service';
import { SalesDashboardService } from './sales-dashboard';
import { SalesDeskJobs } from './sales-desk.jobs';
import { SalesInboundService } from './sales-inbound.service';
import { SalesNegotiationsService } from './sales-negotiations';
import { SalesPipelineService } from './sales-pipeline.service';
import { SalesScopeService } from './sales-scope';

const SERVICES = [
  SalesScopeService,
  SalesPipelineService,
  SalesInboundService,
  SalesCsvService,
  SalesDashboardService,
  DiscountApprovalsService,
  SalesNegotiationsService,
];

/**
 * The company sales desk (D-469) and the discount approval desk (D-470) over the agent programme's lead model
 * (PLAN A-07, A-12). Needs the global `AgentsModule`.
 */
@Global()
@Module({
  providers: [...SERVICES, DiscountedQuotesService, SalesQuoteDiscountCheckout, SalesDeskJobs],
  exports: SERVICES,
})
export class SalesDeskModule {}
