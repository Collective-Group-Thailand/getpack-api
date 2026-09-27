import { Global, Module } from '@nestjs/common';

import { CompaniesService } from './companies.service';
import { CompanyCheckout } from './company-checkout.extension';
import { CompanyScopeResolver } from './company-scope.resolver';

/** B2B companies (D-120…D-125): scope resolver and company-member recipients; services arrive per slice. */
@Global()
@Module({
  providers: [CompanyScopeResolver, CompaniesService, CompanyCheckout],
  exports: [CompaniesService],
})
export class CompaniesModule {}
