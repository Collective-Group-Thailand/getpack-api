import { Global, Module } from '@nestjs/common';

import { CustomersService } from './customers.service';
import { PrivacyService } from './privacy.service';

/** Customer profiles, addresses and tax profiles (schema-design §3.6, B3.1); used by carts and checkout. */
@Global()
@Module({
  providers: [CustomersService, PrivacyService],
  exports: [CustomersService, PrivacyService],
})
export class CustomersModule {}
