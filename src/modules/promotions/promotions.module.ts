import { LookupHasher } from '@common/crypto/lookup-hasher';
import { Global, Module } from '@nestjs/common';

import { IdentityFingerprints } from './identity-fingerprints.service';
import { PromotionCheckout } from './promotion-checkout.extension';
import { PromotionCodes } from './promotion-codes.service';
import { PromotionRedemptions } from './promotion-redemptions.service';
import { PromotionsJobs } from './promotions.jobs';
import { PromotionsAdminService } from './promotions-admin.service';

/**
 * Promotions, campaigns and coupons (D-053, D-154): Marketing admin, coupon codes on the cart, the
 * checkout extension with the pure engine, and redemptions reserved / applied / reversed.
 */
@Global()
@Module({
  providers: [
    LookupHasher,
    IdentityFingerprints,
    PromotionsAdminService,
    PromotionCodes,
    PromotionRedemptions,
    PromotionCheckout,
    PromotionsJobs,
  ],
  exports: [PromotionsAdminService, PromotionCodes, PromotionRedemptions, IdentityFingerprints],
})
export class PromotionsModule {}
