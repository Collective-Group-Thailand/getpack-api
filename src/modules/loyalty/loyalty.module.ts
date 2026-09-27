import { Global, Module } from '@nestjs/common';

import { LoyaltyJobs } from './loyalty.jobs';
import { LoyaltyService } from './loyalty.service';
import { PointsCheckout } from './points-checkout.extension';

/** Loyalty points and tiers (D-130…D-135): earning, crediting, redemption at checkout, expiry. */
@Global()
@Module({
  providers: [LoyaltyService, PointsCheckout, LoyaltyJobs],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
