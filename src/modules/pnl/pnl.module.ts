import { Global, Module } from '@nestjs/common';

import { PnlComputeService } from './pnl-compute.service';
import { PnlDataService } from './pnl-data.service';
import { PnlPlansService } from './pnl-plans.service';
import { PnlViewsService } from './pnl-views.service';

const SERVICES = [PnlDataService, PnlComputeService, PnlPlansService, PnlViewsService];

/**
 * D-472 (PLAN A-14): the management P&L planner — reads the ledger, pipeline, commissions and fixed assets; writes
 * only its own plans. Needs the global `FixedAssetsModule`.
 */
@Global()
@Module({ providers: SERVICES, exports: SERVICES })
export class PnlModule {}
