import { Global, Module } from '@nestjs/common';

import { DiscountCheckout } from './discount-checkout.extension';
import { DiscountMemosJobs } from './discount-memos.jobs';
import { DiscountMemosService } from './discount-memos.service';

/** Staff discounts and discount memos (D-052, D-124, D-162). */
@Global()
@Module({
  providers: [DiscountMemosService, DiscountCheckout, DiscountMemosJobs],
  exports: [DiscountMemosService],
})
export class DiscountMemosModule {}
