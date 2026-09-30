import { Global, Module } from '@nestjs/common';

import { BrandAssetsService } from './brand-assets.service';
import { CompaniesJobs } from './companies.jobs';
import { CompaniesService } from './companies.service';
import { CompanyCheckout } from './company-checkout.extension';
import { CompanyScopeResolver } from './company-scope.resolver';
import { CreditCheckout, CreditService } from './credit.service';

/** B2B companies (D-120…D-125): scope resolver and company-member recipients; services arrive per slice. */
@Global()
@Module({
  providers: [
    CompanyScopeResolver,
    CompaniesService,
    CompanyCheckout,
    CreditService,
    BrandAssetsService,
    CreditCheckout,
    CompaniesJobs,
  ],
  exports: [CompaniesService, CreditService, BrandAssetsService],
})
export class CompaniesModule {}
