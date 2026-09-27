import { Global, Module } from '@nestjs/common';

import { CustomersService } from './customers.service';

/** Customer profiles, addresses and tax profiles (schema-design §3.6, B3.1); used by carts and checkout. */
@Global()
@Module({
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
