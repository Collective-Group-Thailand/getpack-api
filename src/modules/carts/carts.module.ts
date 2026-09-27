import { Global, Module } from '@nestjs/common';

import { CartsService } from './carts.service';

/** Carts (schema-design §3.6, B3.1); checkout reads them. */
@Global()
@Module({
  providers: [CartsService],
  exports: [CartsService],
})
export class CartsModule {}
