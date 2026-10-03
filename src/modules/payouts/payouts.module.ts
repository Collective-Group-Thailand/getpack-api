import { Global, Module } from '@nestjs/common';

import { FinanceViewsService } from './finance-views.service';
import { PayoutsService } from './payouts.service';

/** Payout runs (B5.3, accounting-design §6, D-022, D-093, D-164, D-166): proposal, approval, bank file, confirmation, 50 ทวิ. */
@Global()
@Module({ providers: [PayoutsService, FinanceViewsService], exports: [PayoutsService, FinanceViewsService] })
export class PayoutsModule {}
