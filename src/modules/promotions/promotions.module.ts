import { Global, Module } from '@nestjs/common';

import { PromotionsAdminService } from './promotions-admin.service';

/** Promotions, campaigns and coupons (D-053, D-154); the checkout extension and referral arrive in B3.3. */
@Global()
@Module({
  providers: [PromotionsAdminService],
  exports: [PromotionsAdminService],
})
export class PromotionsModule {}
