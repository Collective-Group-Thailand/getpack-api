import { Global, Module } from '@nestjs/common';

import { SalesInboundService } from './sales-inbound.service';
import { SalesPipelineService } from './sales-pipeline.service';
import { SalesScopeService } from './sales-scope';

const SERVICES = [SalesScopeService, SalesPipelineService, SalesInboundService];

/**
 * The company sales desk (D-469) and the discount approval desk (D-470) over the agent programme's lead model
 * (PLAN A-07, A-12). Needs the global `AgentsModule`.
 */
@Global()
@Module({
  providers: [...SERVICES],
  exports: SERVICES,
})
export class SalesDeskModule {}
