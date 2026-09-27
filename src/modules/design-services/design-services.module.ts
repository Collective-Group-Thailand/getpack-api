import { Global, Module } from '@nestjs/common';

import { DesignServicesService } from './design-services.service';

/** Hired design with revision rounds (D-071, B4.1). */
@Global()
@Module({
  providers: [DesignServicesService],
  exports: [DesignServicesService],
})
export class DesignServicesModule {}
