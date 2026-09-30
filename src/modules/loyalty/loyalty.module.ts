import { Global, Module } from '@nestjs/common';

import { LoyaltyJobs } from './loyalty.jobs';
import { LoyaltyService } from './loyalty.service';
import { PointsCheckout } from './points-checkout.extension';
import { PointsPreviewCheckout } from './points-preview.extension';
import { ReviewsService } from './reviews.service';

/** Loyalty points and tiers (D-130…D-135): earning, crediting, redemption at checkout, expiry. */
@Global()
@Module({
  providers: [LoyaltyService, ReviewsService, PointsCheckout, PointsPreviewCheckout, LoyaltyJobs],
  exports: [LoyaltyService, ReviewsService],
})
export class LoyaltyModule {}
